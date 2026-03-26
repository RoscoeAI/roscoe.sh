import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
export function Panel({ title, subtitle, accentColor = "cyan", rightLabel, children, ...boxProps }) {
    return (_jsxs(Box, { ...boxProps, flexDirection: "column", borderStyle: "round", borderColor: accentColor, paddingX: 1, overflow: "hidden", children: [_jsxs(Box, { justifyContent: "space-between", gap: 1, flexWrap: "wrap", children: [_jsx(Text, { bold: true, color: accentColor, children: title }), rightLabel ? _jsx(Text, { dimColor: true, children: rightLabel }) : _jsx(Text, { dimColor: true, children: " " })] }), subtitle && (_jsx(Text, { dimColor: true, wrap: "wrap", children: subtitle })), _jsx(Box, { marginTop: subtitle ? 1 : 0, flexDirection: "column", children: children })] }));
}
export function KeyHints({ items }) {
    return (_jsx(Box, { gap: 2, flexWrap: "wrap", children: items.map((item) => (_jsxs(Box, { gap: 1, children: [_jsxs(Text, { color: "cyan", children: ["[", item.keyLabel, "]"] }), _jsx(Text, { dimColor: true, children: item.description })] }, `${item.keyLabel}-${item.description}`))) }));
}
export function Pill({ label, color = "gray" }) {
    return (_jsxs(Text, { color: color, children: ["[", label, "]"] }));
}
export function Divider({ label }) {
    if (!label) {
        return _jsx(Text, { dimColor: true, children: "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500" });
    }
    return (_jsxs(Box, { gap: 1, children: [_jsx(Text, { dimColor: true, children: "\u2500\u2500" }), _jsx(Text, { dimColor: true, children: label }), _jsx(Text, { dimColor: true, children: "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500" })] }));
}
