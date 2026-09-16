export interface RepositoryPathInspector {
  exists(repositoryPath: string): Promise<boolean>;
}
