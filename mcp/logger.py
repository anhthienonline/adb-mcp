# MIT License
#
# Copyright (c) 2025 Mike Chambers
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import os
import sys


def log(message, filter_tag="LOGGER"):
    """Write a diagnostic line to stderr.

    Quiet mode is OPT-IN and off by default, so nothing that does not ask for it
    changes behaviour: the five MCP servers never set ADB_QUIET and keep logging
    exactly as before. Only the skills' bridge.py opts in (it sets ADB_QUIET=1 at
    import), because a single proxy call logs the whole document layer tree and a
    build pass makes ~150 of them — megabytes of stderr that bury the result.

    Suppressing these lines does not hide failures: socket_client raises
    RuntimeError / AppError on every error path, so the traceback carries the
    information. ADB_DEBUG=1 always wins and restores full logging.

    The environment is read per call, not at import, so it does not matter whether
    a caller sets the variable before or after this module is first imported.
    """
    quiet = (os.environ.get("ADB_QUIET") == "1"
             and os.environ.get("ADB_DEBUG") != "1")
    if quiet and filter_tag == "LOGGER":
        return          # only the routine per-call chatter is silenceable

    print(f"{filter_tag} : {message}", file=sys.stderr)

