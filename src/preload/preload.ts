import { contextBridge, ipcRenderer } from 'electron';
import type { ExamApi } from '../shared/api';

const api: ExamApi = {
  info: () => ipcRenderer.invoke('app:info'),
  importBank: () => ipcRenderer.invoke('bank:import'),
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
  startPractice: (domains, count) => ipcRenderer.invoke('practice:start', domains, count),
  answerPractice: (questionId, response) => ipcRenderer.invoke('practice:answer', questionId, response),
  practiceSummary: () => ipcRenderer.invoke('practice:summary'),
  quit: () => ipcRenderer.invoke('app:quit'),
};

contextBridge.exposeInMainWorld('examApi', api);
