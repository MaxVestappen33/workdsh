import type {QualityInterpretationCandidate} from '../runtime/interpretation-candidate.js';
import type {QualityReportFields} from '../domain/report-document.js';
import type {QualityRunView} from './run-view.js';
import {qualityReportDraftFieldsSchema} from '../domain/report-draft.js';

type RunScope=Pick<QualityRunView,'recordId'|'runId'|'contentHash'>;
const candidateFields=['recordId','runId','contentHash','sessionId','eventSeq','turn','text','candidateHash'] as const;
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=(value:unknown)=>typeof value==='string'&&Boolean(value.trim())&&value.length<=128&&!/[\u0000-\u001f\u007f]/.test(value);

/** The reply must belong to the exact immutable analytical basis. This check
 * does not replace the Host's Session ownership or completed-turn validation. */
export function reportCandidateMatchesRun(candidate:QualityInterpretationCandidate,run:RunScope):boolean {
 if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||!run||typeof run!=='object')return false;
 return Object.keys(candidate).length===candidateFields.length&&Object.keys(candidate).every(key=>candidateFields.includes(key as typeof candidateFields[number]))&&
  id(candidate.recordId)&&id(candidate.runId)&&hash(candidate.contentHash)&&
  candidate.recordId===run.recordId&&candidate.runId===run.runId&&candidate.contentHash===run.contentHash&&
  typeof candidate.sessionId==='string'&&/^session-[a-f0-9]{32}$/.test(candidate.sessionId)&&
  Number.isSafeInteger(candidate.eventSeq)&&candidate.eventSeq>=0&&Number.isSafeInteger(candidate.turn)&&candidate.turn>=0&&
  typeof candidate.text==='string'&&Boolean(candidate.text.trim())&&new TextEncoder().encode(candidate.text).byteLength<=64*1024&&hash(candidate.candidateHash);
}

/** Re-reading may return a newer reply even in the same native Session. */
export function reportCandidatesEqual(left:QualityInterpretationCandidate,right:QualityInterpretationCandidate):boolean {
 return !!left&&!!right&&candidateFields.every(field=>left[field]===right[field]);
}

/** Adopting only proposes editable report text. No save, truncation, statistics
 * change or inference of separate conclusions occurs in this function. */
export function appendReportAnalysisCandidate(fields:QualityReportFields,candidate:QualityInterpretationCandidate,run:RunScope):QualityReportFields {
 if(!reportCandidateMatchesRun(candidate,run))throw Error('quality/report/candidate-scope-mismatch');
 const proposed=`AI 解读（待人工核对）\n${candidate.text}`;
 return qualityReportDraftFieldsSchema.parse({...fields,analysis:fields.analysis?`${fields.analysis}\n\n${proposed}`:proposed});
}
