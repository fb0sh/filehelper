export { request, ApiError, API_BASE } from './client';
export { authApi } from './auth';
export type { LoginRequest, LoginResponse, SessionInfo } from './auth';
export { messagesApi } from './messages';
export type { Message, MessageAttachment, MessageListResponse } from './messages';
export { uploadFile } from './files';
export type { UploadOptions } from './files';
export { searchApi } from './search';
export type { SearchResponse } from './search';