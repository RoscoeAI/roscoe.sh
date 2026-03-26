import React from "react";
import { Box } from "ink";
interface PanelProps extends Omit<React.ComponentProps<typeof Box>, "children"> {
    title: string;
    subtitle?: string;
    accentColor?: string;
    rightLabel?: string;
    children: React.ReactNode;
}
export declare function Panel({ title, subtitle, accentColor, rightLabel, children, ...boxProps }: PanelProps): import("react/jsx-runtime").JSX.Element;
interface KeyHintsProps {
    items: Array<{
        keyLabel: string;
        description: string;
    }>;
}
export declare function KeyHints({ items }: KeyHintsProps): import("react/jsx-runtime").JSX.Element;
interface PillProps {
    label: string;
    color?: string;
}
export declare function Pill({ label, color }: PillProps): import("react/jsx-runtime").JSX.Element;
export declare function Divider({ label }: {
    label?: string;
}): import("react/jsx-runtime").JSX.Element;
export {};
