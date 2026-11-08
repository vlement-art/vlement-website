import os
import subprocess
import sys
import tempfile
import time

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


source = os.path.abspath(sys.argv[1])
with tempfile.TemporaryDirectory(prefix="vlement-label-uno-") as directory:
    pipe = "vlement_label_" + str(os.getpid())
    process = subprocess.Popen([
        "libreoffice",
        "-env:UserInstallation=" + uno.systemPathToFileUrl(directory),
        "--headless", "--norestore", "--nodefault",
        f"--accept=pipe,name={pipe};urp;StarOffice.ComponentContext",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        for attempt in range(100):
            try:
                context = resolver.resolve(f"uno:pipe,name={pipe};urp;StarOffice.ComponentContext")
                break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError("LibreOffice failed to start")
                time.sleep(0.1)
        else:
            raise RuntimeError("LibreOffice did not become ready")
        desktop = context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        document = desktop.loadComponentFromURL(uno.systemPathToFileUrl(source), "_blank", 0, (prop("Hidden", True),))
        if not document:
            raise RuntimeError("LibreOffice could not open the Word file")
        search = document.createSearchDescriptor()
        search.SearchString = "Pastilla Para Dejar De Soñar"
        found = document.findFirst(search)
        if not found:
            raise RuntimeError("Artwork title is not editable text")
        found.String = "Edited title in LibreOffice"
        target = uno.systemPathToFileUrl(os.path.join(directory, "edited.docx"))
        document.storeAsURL(target, (prop("FilterName", "Office Open XML Text"), prop("Overwrite", True)))
        document.close(True)
        reopened = desktop.loadComponentFromURL(target, "_blank", 0, (prop("Hidden", True),))
        search = reopened.createSearchDescriptor()
        search.SearchString = "Edited title in LibreOffice"
        if not reopened.findFirst(search):
            raise RuntimeError("The edited title did not persist after saving")
        reopened.close(True)
        print("LibreOffice Writer edited and reopened the label title successfully")
    finally:
        process.terminate()
        process.wait(timeout=10)
