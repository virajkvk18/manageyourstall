// Scheduled housekeeping (see maintenance.ts). created by viraj
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("sweep orphan uploads", { hours: 1 }, internal.maintenance.sweepOrphanUploads, {});
crons.interval("sweep expired sessions", { hours: 6 }, internal.maintenance.sweepSessions, {});
export default crons;
