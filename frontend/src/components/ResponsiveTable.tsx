import type { ComponentProps } from 'react'
import { Table } from '@appica/ui-react/table'

/** Keep wide data tables scrollable within their own surface at every width. */
export function ResponsiveTable(props: ComponentProps<typeof Table>) {
  return (
    <div className="responsive-table-scroll">
      <Table {...props} />
    </div>
  )
}
