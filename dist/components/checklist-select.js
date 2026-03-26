import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
export function ChecklistSelect({ options, onSubmit, exclusiveValue, }) {
    const [cursor, setCursor] = useState(0);
    const [selected, setSelected] = useState([]);
    const cappedCursor = Math.max(0, Math.min(cursor, Math.max(0, options.length - 1)));
    const focusedValue = options[cappedCursor];
    const selectedSet = useMemo(() => new Set(selected), [selected]);
    useInput((input, key) => {
        if (key.upArrow) {
            setCursor((current) => (current - 1 + options.length) % options.length);
            return;
        }
        if (key.downArrow) {
            setCursor((current) => (current + 1) % options.length);
            return;
        }
        if (input === " ") {
            setSelected((current) => {
                const next = new Set(current);
                const isActive = next.has(focusedValue);
                if (isActive) {
                    next.delete(focusedValue);
                    return Array.from(next);
                }
                if (exclusiveValue && focusedValue === exclusiveValue) {
                    return [focusedValue];
                }
                if (exclusiveValue) {
                    next.delete(exclusiveValue);
                }
                next.add(focusedValue);
                return Array.from(next);
            });
            return;
        }
        if (key.return) {
            if (selected.length > 0) {
                onSubmit(selected);
                return;
            }
            onSubmit(focusedValue ? [focusedValue] : []);
        }
    }, { isActive: options.length > 0 });
    return (_jsxs(Box, { flexDirection: "column", children: [options.map((option, index) => {
                const focused = index === cappedCursor;
                const checked = selectedSet.has(option);
                return (_jsx(Box, { children: _jsxs(Text, { color: focused ? "cyan" : undefined, children: [focused ? "›" : " ", " ", checked ? "[x]" : "[ ]", " ", option] }) }, `${option}-${index}`));
            }), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { dimColor: true, children: [_jsx(Text, { color: "cyan", children: "\u2191/\u2193" }), " move ", _jsx(Text, { color: "cyan", children: "Space" }), " toggle ", _jsx(Text, { color: "cyan", children: "Enter" }), " submit"] }) })] }));
}
