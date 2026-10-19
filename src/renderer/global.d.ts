// Types for the renderer script. It is a classic script (no imports), so the API types come in globally.
import type * as Api from '../shared/api';

declare global {
  type ExamApi = Api.ExamApi;
  type AppInfo = Api.AppInfo;
  type QuestionView = Api.QuestionView;
  type QuestionType = Api.QuestionType;
  type ExamResult = Api.ExamResult;
  type ExamState = Api.ExamState;
  type DomainId = Api.DomainId;
  type PracticeSummary = Api.PracticeSummary;
  type PracticeFeedback = Api.PracticeFeedback;
  type PracticeOptions = Api.PracticeOptions;
  type PracticeStart = Api.PracticeStart;
  type PracticeAnswer = Api.PracticeAnswer;
  type PracticeVisit = Api.PracticeVisit;
  type PracticeItemState = Api.PracticeItemState;
  type Profile = Api.Profile;
  type HistoryEntry = Api.HistoryEntry;
  type TrainingEntry = Api.TrainingEntry;
  type BankImportSummary = Api.BankImportSummary;
  type ReviewItem = Api.ReviewItem;
  type PausedTraining = Api.PausedTraining;
  type GameStart = Api.GameStart;
  type GameAnswer = Api.GameAnswer;
  type GameSummary = Api.GameSummary;
  type GameSettings = Api.GameSettings;
  type GameStatus = Api.GameStatus;
  type LevelInfo = Api.LevelInfo;
  interface Window {
    examApi: ExamApi;
  }
}
