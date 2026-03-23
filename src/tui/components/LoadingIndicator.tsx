import React,{useState,useEffect} from "react";
import { Text } from "ink";
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const LoadingIndicator: React.FC = () =>{
    const [frame,setFrame] = useState(0)

    useEffect(()=>{
        const timer = setInterval(()=>{
            setFrame(prev => (prev+1)%frames.length)
        },80)

        return () => clearInterval(timer)
    },[])

    return(
        <Text dimColor>
            {frames[frame]} Thinking...
        </Text>
    )
}
