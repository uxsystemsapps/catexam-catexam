import { contextBridge, ipcRenderer } from 'electron';
import type { ExamApi } from '../shared/api';

const api: ExamApi = {
  info: () => ipcRenderer.invoke('app:info'),
  importBanks: () => ipcRenderer.invoke('bank:import'),
  removeBank: (file) => ipcRenderer.invoke('bank:remove', file),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  deleteHistory: (kind, dates) => ipcRenderer.invoke('history:delete', kind, dates),
  examReview: (date) => ipcRenderer.invoke('history:review', date),
  resetProgress: () => ipcRenderer.invoke('progress:reset'),
  lock: () => ipcRenderer.invoke('exam:lock'),
  unlock: () => ipcRenderer.invoke('exam:unlock'),
  startExam: (candidate) => ipcRenderer.invoke('exam:start', candidate),
  answer: (questionId, response) => ipcRenderer.invoke('exam:answer', questionId, response),
  takeBreak: () => ipcRenderer.invoke('exam:break'),
  endExam: () => ipcRenderer.invoke('exam:end'),
  result: () => ipcRenderer.invoke('exam:result'),
  onTimeout: (callback) => {
    ipcRenderer.on('exam:timeout', () => callback());
  },
  onIncident: (callback) => {
    ipcRenderer.on('exam:incident', (_event, message: string) => callback(message));
  },
  // The desktop has no back button.
  onBack: () => undefined,
  startPractice: (options) => ipcRenderer.invoke('practice:start', options),
  answerPractice: (questionId, response) => ipcRenderer.invoke('practice:answer', questionId, response),
  timeoutPractice: (questionId) => ipcRenderer.invoke('practice:timeout', questionId),
  skipPractice: (questionId) => ipcRenderer.invoke('practice:skip', questionId),
  gotoPractice: (number) => ipcRenderer.invoke('practice:goto', number),
  toggleBookmark: (questionId) => ipcRenderer.invoke('practice:bookmark', questionId),
  practiceSummary: () => ipcRenderer.invoke('practice:summary'),
  pausePractice: () => ipcRenderer.invoke('practice:pause'),
  resumePractice: (id) => ipcRenderer.invoke('practice:resume', id),
  deletePaused: (id) => ipcRenderer.invoke('practice:delete-paused', id),
  startGame: (options) => ipcRenderer.invoke('game:start', options),
  startIsland: (domain) => ipcRenderer.invoke('game:island', domain),
  startBoss: (domain) => ipcRenderer.invoke('game:boss', domain),
  startDaily: () => ipcRenderer.invoke('game:daily'),
  startLightning: () => ipcRenderer.invoke('game:lightning'),
  answerGame: (questionId, response) => ipcRenderer.invoke('game:answer', questionId, response),
  timeoutGame: (questionId) => ipcRenderer.invoke('game:timeout', questionId),
  usePowerUp: (id, questionId) => ipcRenderer.invoke('game:power-up', id, questionId),
  gameSummary: () => ipcRenderer.invoke('game:summary'),
  saveGameSettings: (settings) => ipcRenderer.invoke('game:settings', settings),
  quit: () => ipcRenderer.invoke('app:quit'),
};

contextBridge.exposeInMainWorld('examApi', api);
