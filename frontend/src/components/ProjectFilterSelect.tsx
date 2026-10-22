import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import { ToolbarButton } from '@appica/ui-react/toolbar'
import type { Project } from '../lib/api'

/**
 * 项目筛选下拉（工具栏项）：value 为 'all' 或项目 id 字符串，展示文案为项目名
 * （与 value 不一致故传 items 映射）。触发器经 ToolbarButton 组合进工具栏的
 * 漫游焦点顺序，须在 Toolbar 内使用。
 */
export function ProjectFilterSelect({
  projects,
  value,
  onChange,
}: {
  projects: Project[]
  value: string
  onChange: (v: string) => void
}) {
  const items: Record<string, string> = {
    all: '不限项目',
    ...Object.fromEntries(projects.map((p) => [String(p.id), p.name])),
  }
  return (
    <Select value={value} onValueChange={(v) => onChange(v as string)} items={items}>
      <ToolbarButton
        className="w-48"
        render={
          <SelectTrigger aria-label="按项目筛选">
            <SelectValue placeholder="项目" />
          </SelectTrigger>
        }
      />
      <SelectContent>
        <SelectItem value="all">不限项目</SelectItem>
        {projects.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
