import { ProjectContext, ProjectHistoryRecord } from "../config.js";
interface BriefAction {
    label: string;
    value: string;
}
interface ProjectBriefViewProps {
    context: ProjectContext;
    history: ProjectHistoryRecord[];
    actionItems: BriefAction[];
    onAction: (value: string) => void;
    title?: string;
    subtitle?: string;
}
export declare function ProjectBriefView({ context, history, actionItems, onAction, title, subtitle, }: ProjectBriefViewProps): import("react/jsx-runtime").JSX.Element;
export {};
