import { requireProject } from "@/lib/access";
import { listProjectPrds } from "@/lib/requirements";
import { requireSession } from "@/lib/session";
import { listSkills } from "@/lib/skills";
import { getProjectStatus } from "@/lib/status";
import { listTasks } from "@/lib/tasks";
import { TaskBoard } from "../../tasks/task-board";
import { NewTaskDialog } from "../../tasks/task-forms";
import { StatusPanel } from "./status-panel";

export default async function ProjectTasksPage({
  params,
}: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const { user } = await requireSession();
  const [tasks, status, prds, specialists, caller] = await Promise.all([
    listTasks(user.id, id),
    getProjectStatus(user.id, id),
    listProjectPrds(user.id, id),
    listSkills(user.id, { projectId: id }, "guide"),
    requireProject(user.id, id),
  ]);

  return (
    <>
      <StatusPanel s={status} />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Board</h2>
        {caller.caps.has("manage_tasks") && (
          <NewTaskDialog
            projectId={id}
            agents={specialists.map((a) => a.name)}
            prds={prds}
          />
        )}
      </div>
      <TaskBoard
        tasks={tasks}
        projectId={id}
        prds={prds.map((p) => ({ id: p.id, title: p.title }))}
      />
    </>
  );
}
