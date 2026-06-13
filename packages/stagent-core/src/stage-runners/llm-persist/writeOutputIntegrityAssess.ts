export type WriteOutputIntegrityAssessment = 'ok' | 'mismatch';

export class WriteOutputIntegrityMismatchError extends Error {
  readonly rawChars: number;
  readonly writtenChars: number;
  readonly relPath: string;

  constructor(rawChars: number, writtenChars: number, relPath: string) {
    super(`write-output-integrity-mismatch: raw=${rawChars} written=${writtenChars} path=${relPath}`);
    this.name = 'WriteOutputIntegrityMismatchError';
    this.rawChars = rawChars;
    this.writtenChars = writtenChars;
    this.relPath = relPath;
  }
}

export function assessWriteOutputIntegrity(
  rawChars: number,
  writtenChars: number,
): WriteOutputIntegrityAssessment {
  if (rawChars < 500) {
    return 'ok';
  }
  if (writtenChars < 200 && rawChars > 2000) {
    return 'mismatch';
  }
  if (writtenChars / rawChars < 0.25) {
    return 'mismatch';
  }
  return 'ok';
}

export const WRITE_INTEGRITY_RETRY_SYSTEM_APPEND =
  '自动质量兜底：上次输出落盘严重截断。请输出完整文件正文，禁止摘要、占位符或省略号。';
export const WRITE_INTEGRITY_RETRY_USER_APPEND =
  '请输出完整实现文件内容，不要截断、不要只写骨架或注释。';
