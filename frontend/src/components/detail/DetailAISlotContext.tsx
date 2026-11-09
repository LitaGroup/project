import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'

interface DetailAISlotValue {
  slot: HTMLDivElement | null
  setSlot: Dispatch<SetStateAction<HTMLDivElement | null>>
}

const DetailAISlotContext = createContext<DetailAISlotValue | null>(null)

/**
 * 普通页面画布外的 AI 停靠位。
 * 页面通过 Portal 把 AI 面板挂到内容卡之外，同时保持面板组件常驻。
 */
export function DetailAISlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  return (
    <DetailAISlotContext.Provider value={{ slot, setSlot }}>
      {children}
    </DetailAISlotContext.Provider>
  )
}

export function DetailAISlotHost() {
  const context = useContext(DetailAISlotContext)
  if (!context) return null
  const { setSlot } = context
  return <div ref={setSlot} className="contents" />
}

// oxlint-disable-next-line react/only-export-components -- Context 与读取 hook 同文件维护
export function useDetailAISlot() {
  return useContext(DetailAISlotContext)
}
