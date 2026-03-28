export interface Skill {
    name: string
    description: string
    filePath: string
    baseDir: string
    disableModelInvocation: boolean
}

export interface SkillLoadResult {
    skills: Skill[]
    diagnostics: string[]
}

export interface SkillPromptOptions {
    /** Maximum characters for the skills prompt section. Default: 3000 */
    maxChars?: number
}
