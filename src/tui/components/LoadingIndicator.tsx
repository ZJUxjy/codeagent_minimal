import React, { useEffect, useMemo, useState } from "react"
import { Text } from "ink"
import Spinner from "ink-spinner"
import { useTheme } from "../themes/ThemeContext.js"

const WITTY_LOADING_PHRASES_ZH = [
    // --- 职场搬砖系列 ---
    '正在努力搬砖，请稍候...',
    '老板在身后，快加载啊！',
    '头发掉光前，一定能加载完...',
    '服务器正在深呼吸，准备放大招...',
    '正在向服务器投喂咖啡...',

    // --- 大厂黑话系列 ---
    '正在赋能全链路，寻找关键抓手...',
    '正在降本增效，优化加载路径...',
    '正在打破部门壁垒，沉淀方法论...',
    '正在拥抱变化，迭代核心价值...',
    '正在对齐颗粒度，打磨底层逻辑...',
    '大力出奇迹，正在强行加载...',

    // --- 程序员自嘲系列 ---
    '只要我不写代码，代码就没有 Bug...',
    '正在把 Bug 转化为 Feature...',
    '只要我不尴尬，Bug 就追不上我...',
    '正在试图理解去年的自己写了什么...',
    '正在猿力觉醒中，请耐心等待...',

    // --- 合作愉快系列 ---
    '正在询问产品经理：这需求是真的吗？',
    '正在给产品经理画饼，请稍等...',

    // --- 温暖治愈系列 ---
    '每一行代码，都在努力让世界变得更好一点点...',
    '每一个伟大的想法，都值得这份耐心的等待...',
    '别急，美好的事物总是需要一点时间去酝酿...',
    '愿你的代码永无 Bug，愿你的梦想终将成真...',
    '哪怕只有 0.1% 的进度，也是在向目标靠近...',
    '加载的是字节，承载的是对技术的热爱...',
]

const WITTY_LOADING_PHRASES_EN = [
    // --- Work Life ---
    'Working hard so you do not have to...',
    'My boss is watching, hurry up server!',
    'Should be done before I go bald...',
    'The server is taking a deep breath...',
    'Feeding coffee to the server...',

    // --- Corporate Jargon ---
    'Synergizing cross-functional bandwidth...',
    'Optimizing the paradigm shift pipeline...',
    'Leveraging agile best practices...',
    'Disrupting the loading experience...',
    'Aligning stakeholder expectations...',
    'Going the extra mile to load this...',

    // --- Developer Self-Deprecation ---
    'If I do not write code, there are no bugs...',
    'Turning bugs into features...',
    'Act confident and the bugs will not find you...',
    'Trying to understand what I wrote last year...',
    'Developer powers awakening, please wait...',

    // --- Product Manager Fun ---
    'Asking PM: is this requirement for real?',
    'Drawing roadmap pie charts for the PM...',

    // --- Warm & Wholesome ---
    'Every line of code makes the world a little better...',
    'Great ideas are worth the wait...',
    'Good things come to those who wait...',
    'May your code be bug-free and your dreams come true...',
    'Even 0.1% progress is still progress...',
    'Loading bytes, fueled by passion for technology...',
]

function getRandomPhrase(): string {
    const index = Math.floor(Math.random() * WITTY_LOADING_PHRASES_ZH.length)
    return WITTY_LOADING_PHRASES_ZH[index]
}

interface LoadingIndicatorProps {
    text?: string
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
    text,
}) => {
    const { colors } = useTheme()
    const [index,setIndex] = useState(()=>
        Math.floor(Math.random()*WITTY_LOADING_PHRASES_ZH.length)
    )
    useEffect(()=>{
        const timer = setInterval(()=>{
            setIndex(Math.random()*WITTY_LOADING_PHRASES_ZH.length)
        },15_000)
        return () => clearInterval(timer)
    },[])
    const displayText = text ?? WITTY_LOADING_PHRASES_ZH[index]
    return (
        <Text color={colors.text.secondary}>
            <Spinner type="dots12" /> {displayText}
        </Text>
    )
}
