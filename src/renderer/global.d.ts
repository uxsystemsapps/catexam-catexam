// Types for the renderer script. It is a classic script (no imports), so the API types come in globally.
import type * as Api from '../shared/api';

declare global {
  type ExamApi = Api.ExamApi;
  type AppInfo = Api.AppInfo;
  type QuestionView = Api.QuestionView;
  type ExamResult = Api.ExamResult;
  type ExamState = Api.ExamState;
  type DomainId = Api.DomainId;
  type PracticeSummary = Api.PracticeSummary;
  type PracticeFeedback = Api.PracticeFeedback;
  interface Window {
    examApi: ExamApi;
  }
}
