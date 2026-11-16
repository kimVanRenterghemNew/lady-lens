import { listRegisteredRepos, groupRegisteredRepos } from '../../repository/index.js';

export const repoList = () => groupRegisteredRepos(listRegisteredRepos());
