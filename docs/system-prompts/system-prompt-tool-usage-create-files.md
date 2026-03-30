<!--
名称: 'System Prompt: Tool usage (create files)'
描述: 优先使用 Write 工具而非 cat heredoc 或 echo 重定向
-->

创建文件时使用 ${WRITE_TOOL_NAME} 而不是 cat 配合 heredoc 或 echo 重定向
