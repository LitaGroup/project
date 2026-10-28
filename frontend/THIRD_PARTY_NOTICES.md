# UI component notices

Local presentation adaptations retain the following upstream licenses. No upstream demo data, services or paid assets are included.

## Beautiful UI

Source: https://www.beautifului.dev/
Repository: https://github.com/slev12397/beautiful-ui

```text
MIT License

Copyright (c) 2026 Shane Levine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## beUI

Source: https://beui.dev/
Repository: https://github.com/starc007/ui-components

```text
MIT License

Copyright (c) 2026 Saurabh Chauhan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


### beUI component adaptations

Source: https://github.com/starc007/ui-components
Commit: `1572b0ed728836080df8925672df82ce11df6f76`
Documentation: https://beui.dev/components/agents/

The local components in `src/components/beui/` and the presentation of
`src/components/QuestionCard.tsx` adapt the following upstream files:

- `components/agents/todo-list.tsx`: disclosure, completed count, status markers and completion collapse.
- `components/agents/agent-activity/index.tsx`: capped activity viewport and working/completed disclosure.
- `components/agents/agent-activity/activity-row.tsx`: compact tool activity rows.
- `components/agents/streaming-response.tsx`: streaming content shell with existing rendered children.
- `components/agents/approval-card/index.tsx`: muted approval surface, status badge, option and receipt presentation.

Adaptations use existing Framer Motion and Appica dependencies, preserve the host's
question handling and Markdown renderer, and omit upstream demo data, progress estimates,
step navigation, feedback, retry and copy controls.
