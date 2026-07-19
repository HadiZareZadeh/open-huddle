import type { CreateMeetingResponse, MeetingInfo } from '@/types';

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? `Request failed: ${res.status}`,
      res.status,
    );
  }

  return data as T;
}

export async function createMeeting(options?: {
  requireApproval?: boolean;
}): Promise<CreateMeetingResponse> {
  return request<CreateMeetingResponse>('/meetings', {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

export async function getMeetingInfo(id: string): Promise<MeetingInfo> {
  return request<MeetingInfo>(`/meetings/${id}`);
}

export async function getIceServers(): Promise<{ iceServers: RTCIceServer[] }> {
  return request<{ iceServers: RTCIceServer[] }>('/config/ice');
}

export function getMeetingUrl(id: string): string {
  return `${window.location.origin}/meeting/${id}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  }
}
