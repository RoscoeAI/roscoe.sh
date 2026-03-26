interface ChecklistSelectProps {
    options: string[];
    onSubmit: (selected: string[]) => void;
    exclusiveValue?: string;
}
export declare function ChecklistSelect({ options, onSubmit, exclusiveValue, }: ChecklistSelectProps): import("react/jsx-runtime").JSX.Element;
export {};
