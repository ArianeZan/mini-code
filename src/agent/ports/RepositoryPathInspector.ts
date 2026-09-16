export interface RepositoryPathInspector {
  exists(repositoryPath: string): Promise<boolean>;
  assertCanCreate(repositoryPath: string): Promise<void>;
}
