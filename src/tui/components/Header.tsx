import { Box, Text } from "ink";
import React from "react";

interface HeaderProps {
    model: string
    provider: string
}

export const Header: React.FC<HeaderProps> = ({ model, provider }) => {
    return (
        <Box marginBottom={1}>
            <Text bold color="magenta">lop_minimal</Text>
            <Text dimColor> v0.1.0 | </Text>
            <Text dimColor>{provider}/{model}</Text>
        </Box>
    )
}