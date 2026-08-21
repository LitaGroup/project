import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from '@appica/ui-react/breadcrumb'

export interface Crumb {
  label: string
  /** 提供则为可点击层级，缺省或最后一级渲染为当前页纯文本 */
  to?: string
}

/** 页面顶部面包屑：展示当前页所处层级（如 任务 / 项目名 / 任务标题），各级均可点击返回 */
export function PageBreadcrumb({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <Fragment key={i}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {item.to && !last ? (
                  <BreadcrumbLink render={<Link to={item.to} />}>
                    {item.label}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbLink active>{item.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
