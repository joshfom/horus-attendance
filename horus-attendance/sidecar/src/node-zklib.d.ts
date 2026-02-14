declare module 'node-zklib' {
  interface ZKLibOptions {
    ip: string;
    port: number;
    timeout?: number;
    inport?: number;
  }

  interface User {
    uid: number;
    userId: string;
    name: string;
    role: number;
    password: string;
    cardno: number;
  }

  interface Attendance {
    uid: number;
    id: number;
    state: number;
    timestamp: Date | string;
  }

  class ZKLib {
    constructor(ip: string, port: number, timeout?: number, inport?: number);
    createSocket(): Promise<boolean>;
    getUsers(): Promise<{ data: User[] }>;
    getAttendances(): Promise<{ data: Attendance[] }>;
    getSerialNumber(): Promise<string>;
    getFirmware(): Promise<string>;
    getTime(): Promise<Date>;
    disconnect(): Promise<void>;
  }

  export = ZKLib;
}
