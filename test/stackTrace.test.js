/**
 * Dashboard stack trace (backlog/dashboard-ontwikkelaar.md, AC1, AC2, J1-J3): a pasted trace in Node, .NET, Python or
 * Java gives frames tied to a project file and the function at the line; paths from another machine match on their
 * tail, equal tails ask to choose, nothing matching is "notFound", library frames are marked as such.
 */
import { describe, it, expect } from 'vitest';
import { parseStackTrace, locateFrames, traceView } from '../core/search/index.js';

const nodes = [
    { id: 'file:core/a.js', type: 'CodeFile', path: 'core/a.js', symbolRanges: { outer: [1, 40], inner: [10, 20] } },
    { id: 'file:core/b.js', type: 'CodeFile', path: 'core/b.js', symbolRanges: { run: [1, 9] } },
    { id: 'file:x/index.js', type: 'CodeFile', path: 'x/index.js', symbolRanges: {} },
    { id: 'file:y/index.js', type: 'CodeFile', path: 'y/index.js', symbolRanges: {} },
    { id: 'file:Svc.cs', type: 'CodeFile', path: 'src/Shop/OrderService.cs', symbolRanges: { PlaceOrder: [30, 60] } },
    { id: 'file:job.py', type: 'CodeFile', path: 'app/jobs/job.py', symbolRanges: { handle: [5, 15] } },
    { id: 'file:Foo.java', type: 'CodeFile', path: 'src/main/java/com/acme/Foo.java', symbolRanges: { bar: [40, 50] } },
    { id: 'doc:README.md', type: 'Document', path: 'README.md' }
];

describe('stack trace in the dashboard', () => {
    it('J1: a Node trace ties project frames to file and innermost function, and marks library frames', () => {
        const trace = [
            'TypeError: Cannot read properties of undefined',
            '    at inner (C:\\build\\agent\\work\\core\\a.js:12:5)',
            '    at /home/ci/repo/core/b.js:3:1',
            '    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)',
            '    at node:internal/process/task_queues:95:5',
            '    at async outer (file:///C:/dev/repo/core/a.js:30:9)'
        ].join('\n');
        const { frames, counts } = traceView(trace, nodes);
        expect(frames.map(f => [f.status, f.path ?? null, f.symbol ?? null, f.line])).toEqual([
            ['project', 'core/a.js', 'inner', 12],
            ['project', 'core/b.js', 'run', 3],
            ['library', null, null, 95],
            ['library', null, null, 95],
            ['project', 'core/a.js', 'outer', 30]
        ]);
        expect(frames[0].start).toBe(true);
        expect(frames.filter(f => f.start)).toHaveLength(1);
        expect(counts).toEqual({ project: 3, ambiguous: 0, notFound: 0, library: 2 });
    });

    it('J2: a .NET trace from a build machine matches on the tail of its path; a frame without file is library', () => {
        const frames = traceView([
            '   at Shop.OrderService.PlaceOrder(Order order) in D:\\a\\1\\s\\src\\Shop\\OrderService.cs:line 42',
            '   at System.Threading.Tasks.Task.Execute()'
        ].join('\r\n'), nodes).frames;
        expect(frames[0]).toMatchObject({ status: 'project', path: 'src/Shop/OrderService.cs', symbol: 'PlaceOrder', line: 42, name: 'Shop.OrderService.PlaceOrder' });
        expect(frames[1]).toMatchObject({ status: 'library', file: null });
    });

    it('reads Python and Java frames; the Java package gives the folders', () => {
        const frames = traceView([
            'Traceback (most recent call last):',
            '  File "/srv/app/jobs/job.py", line 7, in handle',
            '    do()',
            '  File "/usr/lib/python3.11/site-packages/x.py", line 1, in do',
            'Exception in thread "main" java.lang.IllegalStateException',
            '\tat com.acme.Foo.bar(Foo.java:44)',
            '\tat java.base/java.lang.Thread.run(Native Method)'
        ].join('\n'), nodes).frames;
        expect(frames.map(f => [f.status, f.path ?? null, f.symbol ?? null])).toEqual([
            ['project', 'app/jobs/job.py', 'handle'],
            ['library', null, null],
            ['project', 'src/main/java/com/acme/Foo.java', 'bar'],
            ['library', null, null]
        ]);
    });

    it('J3: two files with the same tail ask to choose; a path nowhere in the project is notFound', () => {
        const frames = traceView('    at go (/ci/index.js:2:1)\n    at /ci/elsewhere/zzz.js:1:1', nodes).frames;
        expect(frames[0].status).toBe('ambiguous');
        expect(frames[0].candidates.map(c => c.path)).toEqual(['x/index.js', 'y/index.js']);
        expect(frames[1].status).toBe('notFound');
    });

    it('MUST skip lines that are not frames without failing', () => {
        expect(parseStackTrace('hello\n\n   at nothing here\nError: x')).toEqual([]);
        expect(parseStackTrace(undefined)).toEqual([]);
        expect(locateFrames([], nodes)).toEqual([]);
    });
});
