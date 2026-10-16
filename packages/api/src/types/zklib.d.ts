// Minimal typings for the untyped `zklib` package (ZKTeco TCP/UDP port 4370).
declare module 'zklib' {
  export interface ZKAttendanceRecord {
    uid?: number;
    user_id?: string | number;
    id?: string | number;
    timestamp?: string;
    time?: string;
    status?: number;
    punch?: number;
    inout?: number;
    [key: string]: unknown;
  }

  export default class ZKLib {
    constructor(ip: string, port?: number, timeout?: number, inport?: number);
    createSocket(): Promise<void>;
    getAttendances(): Promise<ZKAttendanceRecord[]>;
    disconnect(): Promise<void>;
  }
}
