import { describe, expect, it } from 'vitest'
import { InvalidPipeline, parsePipeline, runPipeline } from '../../src/core/logPipeline.js'

const run = (pipeline: string, output: string) => runPipeline(parsePipeline(pipeline), output)

const NODE_TEST = ['ok 1 - toCsv makes a header', 'not ok 2 - toCsv quotes commas', '# tests 25', '# pass 24', '# fail 1', '# duration_ms 140.2', ''].join('\n')

describe('the LogQL subset a tool capture keeps output with', () => {
  it('filters lines by text and by regular expression', () => {
    expect(run('|= "not ok"', NODE_TEST).map((entry) => entry.line)).toEqual(['not ok 2 - toCsv quotes commas'])
    expect(run('!= "ok"', NODE_TEST).map((entry) => entry.line)).toEqual(['# tests 25', '# pass 24', '# fail 1', '# duration_ms 140.2'])
    expect(run('|~ `^# (pass|fail) `', NODE_TEST)).toHaveLength(2)
    expect(run('!~ "^#"', NODE_TEST)).toHaveLength(2)
  })

  it('names fields with pattern, and filters and formats by them', () => {
    const totals = run('|~ `^# (tests|pass|fail) ` | pattern `# <what> <count>`', NODE_TEST)
    expect(totals.map((entry) => entry.fields)).toEqual([
      { what: 'tests', count: '25' },
      { what: 'pass', count: '24' },
      { what: 'fail', count: '1' },
    ])
    expect(run('|~ `^# ` | pattern `# <what> <count>` | what = "fail" | count > 0 | line_format "{{.count}} failed"', NODE_TEST).map((entry) => entry.line)).toEqual(['1 failed'])
    expect(run('| pattern `<_> - <name>` | name =~ "toCsv.*" | line_format "{{ __line__ }}"', NODE_TEST)).toHaveLength(2)
  })

  it('names fields with regexp, in Go or JavaScript style', () => {
    expect(run('| regexp "^not ok (?P<number>\\\\d+) - (?<name>.*)$" | number >= 2', NODE_TEST).map((entry) => entry.fields)).toEqual([{ number: '2', name: 'toCsv quotes commas' }])
  })

  it('reads JSON and logfmt lines', () => {
    const jest = '{"numTotalTests":12,"numFailedTests":0,"testResults":{"status":"passed"}}'
    expect(run('| json', jest)[0]!.fields).toEqual({ numTotalTests: '12', numFailedTests: '0', testResults_status: 'passed' })
    expect(run('| json total="numTotalTests", status="testResults.status"', jest)[0]!.fields).toEqual({ total: '12', status: 'passed' })
    expect(run('| json numFailedTests | numFailedTests == 0', jest)).toHaveLength(1)
    expect(run('| logfmt | level = "error"', 'level=info msg=ok\nlevel=error msg="it broke" code=7')[0]!.fields).toEqual({ level: 'error', msg: 'it broke', code: '7' })
  })

  it('refuses what is outside the subset, saying where', () => {
    expect(() => parsePipeline('')).toThrow(InvalidPipeline)
    expect(() => parsePipeline('{job="x"} |= "a"')).toThrow(/expected \| or a line filter at "\{job/)
    expect(() => parsePipeline('| unpack')).toThrow(/expected ==, !=|expected a parser, line_format, or a field filter/)
    expect(() => parsePipeline('|= unquoted')).toThrow(/expected a string in "\.\.\." or `\.\.\.`/)
    expect(() => parsePipeline('|~ "("')).toThrow(/is not a regular expression/)
    expect(() => parsePipeline('| pattern "no captures"')).toThrow(/names nothing to capture/)
  })
})
