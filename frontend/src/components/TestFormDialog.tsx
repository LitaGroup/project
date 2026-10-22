import { useState } from 'react'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@appica/ui-react/dialog'
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteList,
  AutocompleteItem,
} from '@appica/ui-react/autocomplete'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import { api, type ProjectTest } from '../lib/api'

/** 新建/编辑测试：脚本位置支持从 .test.ts 文件中自动联想、搜索 */
export function TestFormDialog({
  projectId,
  test,
  onSaved,
}: {
  projectId: number
  /** 传入则为编辑，否则为新建 */
  test?: ProjectTest
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [scriptPath, setScriptPath] = useState('')
  const [scripts, setScripts] = useState<string[]>([])
  // 运行设备：server/h5 本地直跑；android/ios 走 appium-agent 远程
  const [device, setDevice] = useState<string>('server')
  const [error, setError] = useState<string | null>(null)

  // 打开时初始化表单，并拉取脚本文件列表供自动联想
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setCode(test?.code ?? '')
      setDescription(test?.description ?? '')
      setScriptPath(test?.scriptPath ?? '')
      setDevice(test?.device ?? 'server')
      setError(null)
      api
        .listTestScripts(undefined, projectId)
        .then(setScripts)
        .catch(() => setScripts([]))
    }
  }

  const submit = () => {
    setError(null)
    const saving = test
      ? api.updateTest(test.id, { code, description, scriptPath, device })
      : api.createTest({
          projectId,
          code,
          description: description || undefined,
          scriptPath,
          device,
        })
    saving
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {test ? '编辑' : '添加测试'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{test ? '编辑测试' : '添加测试'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              编号（手工定义，项目内唯一）
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="如 TEST-001"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              描述（脚本测试的内容）
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这个脚本测试什么…"
                rows={3}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              脚本（输入关键字自动联想 .test.ts 文件）
              <Autocomplete
                items={scripts}
                value={scriptPath}
                onValueChange={(v) => setScriptPath(v as string)}
                clearable
              >
                <AutocompleteInput
                  placeholder="如 projects/active/pk/tests/xxx.test.ts"
                  aria-label="脚本"
                />
                <AutocompleteContent>
                  <AutocompleteEmpty>未找到匹配的脚本</AutocompleteEmpty>
                  <AutocompleteList>
                    {(item: string) => (
                      <AutocompleteItem key={item} value={item}>
                        {item}
                      </AutocompleteItem>
                    )}
                  </AutocompleteList>
                </AutocompleteContent>
              </Autocomplete>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              运行设备（server/h5 本地直跑；android/ios 走 appium-agent 远程）
              <Select
                value={device}
                onValueChange={(v) => setDevice(v as string)}
                items={{
                  server: 'server（后端/服务端）',
                  h5: 'h5（前端页面）',
                  android: 'Android（appium）',
                  ios: 'iOS（appium）',
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="server">
                    server（后端/服务端）
                  </SelectItem>
                  <SelectItem value="h5">h5（前端页面）</SelectItem>
                  <SelectItem value="android">Android（appium）</SelectItem>
                  <SelectItem value="ios">iOS（appium）</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!code.trim() || !scriptPath.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
