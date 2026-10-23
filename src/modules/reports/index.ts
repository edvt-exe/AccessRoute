// browser side api, the server handlers in ./api are used only by src/app/api routes
export {
  useProblems,
  fetchProblems,
  reportProblem,
  resolveProblem,
  useRecordingRequests,
  requestRecording,
  markRequestDone,
  useObstacles,
  fetchObstacles,
  addObstacle,
  removeObstacle,
  obstacleSpot,
} from "./lib/client";
export { ObstacleEditor } from "./components/ObstacleEditor";
export { ProblemReport } from "./components/ProblemReport";
