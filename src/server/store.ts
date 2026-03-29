import type {CoreMessage} from "ai"

export interface MessageStore{
    add(message:CoreMessage):void
    getAll():CoreMessage[]
    clear():void
    replaceAll(messages:CoreMessage[]):void
}

export class InMemoryStore implements MessageStore{
    private messages: CoreMessage[]=[]

    add(message:CoreMessage):void{
        this.messages.push(message)
    }

    getAll(): CoreMessage[] {
        return [...this.messages]
    }

    clear(): void {
        this.messages=[]
    }

    replaceAll(messages:CoreMessage[]):void{
        this.messages=[...messages]
    }
}