"""No user data: fail closed on absent and unsigned dependency sources."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('operation',Path(__file__).parents[1]/'src/offline-operation.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class HostDependencyTests(unittest.TestCase):
 def test_absent_package(self):
  with tempfile.TemporaryDirectory() as root:
   with self.assertRaisesRegex(ValueError,'HOST_DEPENDENCY_UNAVAILABLE'):m.host_identity(root)
 def test_unsigned_interpreter(self):
  with tempfile.TemporaryDirectory() as root:
   Path(root,'numpy').mkdir()
   with patch.object(m.subprocess,'run',return_value=type('R',(),{'returncode':1,'stderr':b'TeamIdentifier=not set'})()):
    with self.assertRaisesRegex(ValueError,'SIGNATURE_FAILED'):m.host_identity(root)
 def test_team_mismatch(self):
  with tempfile.TemporaryDirectory() as root:
   package=Path(root,'numpy');package.mkdir();(package/'native.so').write_bytes(b'fixture')
   responses=[type('R',(),{'returncode':0,'stderr':b''})(),type('R',(),{'returncode':0,'stderr':b'TeamIdentifier=HOST'})(),type('R',(),{'returncode':0,'stderr':b''})(),type('R',(),{'returncode':0,'stderr':b'TeamIdentifier=OTHER'})()]
   with patch.object(m.subprocess,'run',side_effect=responses):
    with self.assertRaisesRegex(ValueError,'SIGNATURE_FAILED'):m.host_identity(root)
if __name__=='__main__':unittest.main()
