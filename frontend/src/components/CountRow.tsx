import { TableCell, TableRow } from '@appica/ui-react/table'

/** 栏目计数行：放在表格 TableBody 末尾，跨整行右对齐展示「总共 x 条，展示 y 条」；无数据时不渲染 */
export function CountRow({
  colSpan,
  total,
  displayed,
}: {
  colSpan: number
  total: number
  displayed: number
}) {
  if (total === 0) return null
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className="text-right text-xs text-foreground-muted"
      >
        总共 {total} 条，展示 {displayed} 条
      </TableCell>
    </TableRow>
  )
}
