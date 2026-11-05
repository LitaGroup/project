import { Navigate } from 'react-router-dom'

/** 顶部「工单」默认页：进入我的工单 */
export function TicketHomePage() {
  return <Navigate replace to="/tickets/mine" />
}
