export interface ChangeDiff {
  validate(): Promise<void>;
  generate(): Promise<string>;
}
