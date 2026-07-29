export type InngestEvent = Readonly<{
  data: Readonly<Record<string, unknown>>;
}>;

export type InngestStep = Readonly<{
  run<T>(id: string, operation: () => Promise<T> | T): Promise<T>;
}>;

export type InngestFunction = Readonly<{
  id?: string;
}>;

export class Inngest {
  constructor(options: Readonly<{ id: string }>);
  createFunction(
    options: Readonly<{
      id: string;
      retries?: number;
      concurrency?:
        | Readonly<{ limit: number; key?: string }>
        | readonly Readonly<{ limit: number; key?: string }>[];
      triggers: Readonly<{ event: string }> | Readonly<{ cron: string }>;
    }>,
    handler: (context: Readonly<{ event: InngestEvent; step: InngestStep }>) => Promise<unknown>
  ): InngestFunction;
  send(
    event: Readonly<{
      id?: string;
      name: string;
      data: Readonly<Record<string, unknown>>;
    }>
  ): Promise<unknown>;
}
