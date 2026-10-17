"""Trusted bootstrap executed inside the official shell capability.

No downloads, shared-environment installs or user-supplied code. The Host supplies
the reviewed package manifest; all wheel bytes are verified again before staging.
The shell owner remains responsible for process sandbox, deadline and job lifecycle.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import venv


stage = "INPUT"

def host_identity(root):
    """Read-only identity of the explicitly allowed host dependency closure."""
    root = Path(root).resolve()
    package = root / "numpy"
    if not package.is_dir() or package.is_symlink():
        raise ValueError("HOST_DEPENDENCY_UNAVAILABLE")
    def team(path):
        verified = subprocess.run(["/usr/bin/codesign", "--verify", "--strict", str(path)], capture_output=True, timeout=10)
        details = subprocess.run(["/usr/bin/codesign", "-dv", "--verbose=2", str(path)], capture_output=True, timeout=10)
        identity = next((line.split("=", 1)[1] for line in details.stderr.decode().splitlines() if line.startswith("TeamIdentifier=")), None)
        if verified.returncode or details.returncode or not identity or identity == "not set":
            raise ValueError("HOST_DEPENDENCY_SIGNATURE_FAILED")
        return identity
    interpreter_team = team(Path(sys.executable).resolve())
    digest = hashlib.sha256()
    files = []
    for directory in [package, root / "numpy.libs"]:
        if directory.exists():
            for file in sorted(directory.rglob("*")):
                if file.is_symlink():
                    raise ValueError("HOST_DEPENDENCY_UNAVAILABLE")
                if file.is_file() and "__pycache__" not in file.parts and file.suffix != ".pyc":
                    files.append(file)
    for file in files:
        digest.update(str(file.relative_to(root)).encode())
        digest.update(hashlib.sha256(file.read_bytes()).digest())
        if file.suffix in (".so", ".dylib") and team(file) != interpreter_team:
            raise ValueError("HOST_DEPENDENCY_SIGNATURE_FAILED")
    if not any(file.suffix == ".so" for file in files):
        raise ValueError("HOST_DEPENDENCY_UNAVAILABLE")
    return {"name": "numpy", "version": "2.3.5", "contentSha256": digest.hexdigest(), "teamId": interpreter_team}


def run(payload):
    global stage
    manifest = payload["manifest"]
    request = payload["input"]
    if request.get("operation") not in manifest["operations"]:
        raise ValueError("UNSUPPORTED_OPERATION")
    root = Path(payload["directory"])
    host = None
    if manifest.get("contractVersion") == 2:
        stage = "HOST_DEPENDENCY"
        host = host_identity(payload["hostPackages"])
    stage = "TEMPORARY_DIRECTORY"
    with tempfile.TemporaryDirectory(prefix=".workdsh-compute-", dir=os.getcwd()) as temporary:
        temporary = Path(temporary)
        wheels = temporary / "wheels"
        wheels.mkdir()
        requirements = []
        stage = "ARTIFACT_READ"
        for artifact in manifest["artifacts"]:
            source = root / artifact["file"]
            if source.is_symlink() or not source.is_file():
                raise ValueError("ARTIFACT_CHANGED")
            data = source.read_bytes()
            if len(data) != artifact["bytes"] or hashlib.sha256(data).hexdigest() != artifact["sha256"]:
                raise ValueError("ARTIFACT_CHANGED")
            (wheels / artifact["file"]).write_bytes(data)
            requirements.append(f"{artifact['name']}=={artifact['version']} --hash=sha256:{artifact['sha256']}\n")
        lock = temporary / "requirements.lock"
        lock.write_text("".join(requirements), encoding="utf-8")
        environment = temporary / "environment"
        stage = "ENVIRONMENT_CREATE"
        venv.EnvBuilder(with_pip=True, system_site_packages=False).create(environment)
        python = environment / "bin" / "python"
        # --isolated ignores user pip config and environment options; no index,
        # source distributions, dependency resolution beyond the hash lock, or PATH.
        stage = "OFFLINE_INSTALL"
        install = subprocess.run([str(python), "-I", "-m", "pip", "--isolated", "install",
                                  "--no-index", "--no-deps", "--only-binary=:all:", "--require-hashes",
                                  "--find-links", str(wheels), "-r", str(lock)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
        if install.returncode:
            raise ValueError("OFFLINE_INSTALL_FAILED")
        stage = "STATISTICS"
        encoded = json.dumps(request, allow_nan=False, ensure_ascii=False).encode()
        command = [str(python), "-I", "-m", manifest["module"]]
        if host:
            # Only the declared numpy package is discoverable from the shared
            # directory. Do not add all host site-packages to sys.path.
            bootstrap = """import importlib.abc,importlib.machinery,runpy,sys
+class HostNumpy(importlib.abc.MetaPathFinder):
+ def find_spec(self,fullname,path=None,target=None):
+  if fullname == 'numpy': return importlib.machinery.PathFinder.find_spec(fullname,[sys.argv[1]])
+  return None
+sys.meta_path.insert(0,HostNumpy())
+import numpy
+if numpy.__version__ != '2.3.5': raise ValueError('HOST_DEPENDENCY_VERSION_MISMATCH')
+if not numpy.allclose(numpy.linalg.lstsq(numpy.array([[1.,0.],[1.,1.],[1.,2.]]),numpy.array([1.,3.,5.]),rcond=None)[0],[1.,2.]): raise ValueError('HOST_DEPENDENCY_PRIMITIVE_FAILED')
+runpy.run_module(sys.argv[2],run_name='__main__')
+""".replace("\n+", "\n")
            command = [str(python), "-I", "-c", bootstrap, payload["hostPackages"], manifest["module"]]
        operation = subprocess.run(command, input=encoded,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
        if len(operation.stdout) > 8 * 1024 * 1024:
            raise ValueError("RESULT_SIZE_LIMIT")
        if not operation.stdout.strip():
            diagnostic = operation.stderr.decode("utf-8", errors="replace")[:16384]
            if "ModuleNotFoundError" in diagnostic:
                raise ValueError("STATISTICS_MODULE_MISSING")
            if "ImportError" in diagnostic or "Library not loaded" in diagnostic or "dlopen" in diagnostic:
                raise ValueError("STATISTICS_IMPORT_FAILED")
            if "PermissionError" in diagnostic or "Operation not permitted" in diagnostic:
                raise ValueError("STATISTICS_ACCESS_DENIED")
            raise ValueError("STATISTICS_PROCESS_FAILED")
        result = json.loads(operation.stdout)
        if operation.returncode or result.get("ok") is not True:
            code = result.get("error", {}).get("code", "COMPUTATION_FAILED")
            raise ValueError(code if isinstance(code,str) and code.replace("_", "").isupper() else "COMPUTATION_FAILED")
        if host:
            stage = "HOST_DEPENDENCY"
            if host_identity(payload["hostPackages"]) != host:
                raise ValueError("HOST_DEPENDENCY_CHANGED")
            result["hostDependency"] = host
        return result


if __name__ == "__main__":
    def terminate(_signum, _frame):
        # Unwind the temporary environment on the official shell's SIGTERM.
        raise InterruptedError("COMPUTE_CANCELLED")
    signal.signal(signal.SIGTERM, terminate)
    input_path = None
    try:
        if sys.argv[1] == "--payload-file":
            input_path = Path(sys.argv[2])
            if (not input_path.is_absolute() or input_path.name != "payload.json"
                    or not input_path.parent.name.startswith(".workdsh-compute-input-")
                    or input_path.is_symlink() or input_path.parent.is_symlink()):
                input_path = None
                raise ValueError("INPUT_INVALID_PATH")
            with os.fdopen(os.open(input_path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as stream:
                data = stream.read(8 * 1024 * 1024 + 1)
            if len(data) > 8 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != sys.argv[3]:
                raise ValueError("INPUT_CHANGED")
            payload = json.loads(data)
            # Remove staged measurements before starting the potentially long
            # computation, including computations later cancelled or promoted.
            input_path.unlink()
            input_path.parent.rmdir()
            input_path = None
        else:
            payload = json.loads(base64.b64decode(sys.argv[1], validate=True))
        print(json.dumps(run(payload), allow_nan=False, ensure_ascii=False))
    except (ValueError, KeyError, TypeError, OSError, subprocess.TimeoutExpired) as error:
        code = "COMPUTE_CANCELLED" if isinstance(error, InterruptedError) else str(error) if isinstance(error, ValueError) else "COMPUTATION_FAILED"
        if not code or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ_" for c in code):
            code = "COMPUTATION_FAILED"
        print(json.dumps({"contractVersion":1,"ok":False,"error":{"code":code,"stage":stage,"reason":"ACCESS_DENIED" if isinstance(error, PermissionError) else "FILE_NOT_FOUND" if isinstance(error, FileNotFoundError) else "TIMEOUT" if isinstance(error, subprocess.TimeoutExpired) else "INVALID_OUTPUT" if isinstance(error, json.JSONDecodeError) else "FAILED"}}))
        sys.exit(2)
    finally:
        if input_path is not None:
            input_path.unlink(missing_ok=True)
            input_path.parent.rmdir()
