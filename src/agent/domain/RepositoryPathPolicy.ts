const RESTRICTED_NAMES = new Set([
  '.aws',
  '.git',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.ssh',
  '.venv',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
  'venv',
]);

export function isRestrictedRepositoryName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    RESTRICTED_NAMES.has(normalizedName) ||
    normalizedName === 'id_rsa' ||
    normalizedName === 'id_ed25519' ||
    normalizedName.endsWith('.key') ||
    normalizedName.endsWith('.pem')
  );
}

export function isRestrictedEnvironmentFile(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    normalizedName === '.env' ||
    (normalizedName.startsWith('.env.') && normalizedName !== '.env.example')
  );
}

export function isRestrictedRepositoryPath(repositoryPath: string): boolean {
  return repositoryPath
    .split(/[\\/]+/)
    .some(
      (segment) =>
        isRestrictedRepositoryName(segment) || isRestrictedEnvironmentFile(segment),
    );
}
