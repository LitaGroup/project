/** 运行统计展示：success 绿 / fail 大于 0 红、为 0 绿 / total 默认前景色 */
export function RunStats({
  stats,
}: {
  stats: { success: number; fail: number; total: number }
}) {
  return (
    <>
      <span className="text-success-emphasis">{stats.success}</span>/
      <span
        className={
          stats.fail > 0 ? 'text-error-emphasis' : 'text-success-emphasis'
        }
      >
        {stats.fail}
      </span>
      /{stats.total}
    </>
  )
}
