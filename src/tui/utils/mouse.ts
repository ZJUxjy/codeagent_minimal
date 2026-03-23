const CSI='\x1b[';

export function enableMouse(mode:number=1006){
    process.stdout.write(`${CSI}?${mode}h`)
}

export function disableMouse(mode:number=1006){
    process.stdout.write(`${CSI}?${mode}l`)
}

export interface MouseEvent{
    type:'press'|'release'|'move'|'scroll'
    button: 'left' | 'right'
    x:number
    y:number
    shift:boolean
    ctrl:boolean
    meta:boolean
}

// 解析 SGR 格式的鼠标事件 (mode 1006)
// 格式: ESC [ < Cb ; Cx ; Cy M/m
export function parseMouseSGR(data:string):MouseEvent | null{
    const match = data.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if(!match) return null;

    const cb = parseInt(match[1],10)
    const x = parseInt(match[2],10)
    const y = parseInt(match[3],10)
    const isRelease = match[4]==='m'

    // 解析按钮和修饰键
    const button = cb & 0b11;
    const shift = !!(cb & 0b100);
    const meta = !!(cb & 0b1000);
    const ctrl = !!(cb & 0b10000);

    const buttonNames = ['left', 'right'] as const;

    return {
      type: isRelease ? 'release' : 'press',
      button: buttonNames[button] || 'left',
      x, y, shift, ctrl, meta,
    };
}