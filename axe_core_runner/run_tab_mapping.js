import html2canvas from 'html2canvas';

/**
 * Captures the page and draws the keyboard tab sequence on top of it.
 */
export async function generateFullTabMap() {
    // 1. Identify all focusable elements
    const selector = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';
    const rawElements = Array.from(document.querySelectorAll(selector));

    // 2. Filter and Sort according to browser tabbing rules
    const focusable = rawElements
        .filter(el => {
            const tabIndex = parseInt(el.getAttribute('tabindex') || '0');
            const style = window.getComputedStyle(el);
            const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0 && style.visibility !== 'hidden';
            return tabIndex >= 0 && isVisible && !el.hasAttribute('disabled');
        })
        .map(el => ({
            element: el,
            tabIndex: parseInt(el.getAttribute('tabindex') || '0'),
            rect: el.getBoundingClientRect()
        }))
        .sort((a, b) => {
            // Priority 1: positive tabIndexes (1, 2, 3...)
            if (a.tabIndex > 0 && b.tabIndex > 0) return a.tabIndex - b.tabIndex;
            if (a.tabIndex > 0) return -1;
            if (b.tabIndex > 0) return 1;
            // Priority 2: Source order (tabIndex 0)
            return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });

    // 3. Render page to Canvas
    const canvas = await html2canvas(document.body, {
        allowTaint: true,
        useCORS: true,
        logging: false,
        scrollY: -window.scrollY
    });

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 4. Draw overlays
    ctx.lineWidth = 2;
    ctx.font = 'bold 12px sans-serif';

    focusable.forEach((item, index) => {
        const { left, top, width, height } = item.rect;
        const x = left + window.scrollX;
        const y = top + window.scrollY;

        // Draw selection box
        ctx.strokeStyle = '#2563eb';
        ctx.strokeRect(x, y, width, height);

        // Draw sequence number circle
        ctx.fillStyle = '#2563eb';
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fill();

        // Draw number text
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((index + 1).toString(), x, y);

        // Draw line to the next item
        if (index < focusable.length - 1) {
            const next = focusable[index + 1].rect;
            const nextX = next.left + next.width / 2 + window.scrollX;
            const nextY = next.top + next.height / 2 + window.scrollY;
            
            ctx.beginPath();
            ctx.setLineDash([5, 5]);
            ctx.moveTo(x + width / 2, y + height / 2);
            ctx.lineTo(nextX, nextY);
            ctx.stroke();
        }
    });

    // 5. Trigger download
    const link = document.createElement('a');
    link.download = `tab-map-${new Date().getTime()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}
