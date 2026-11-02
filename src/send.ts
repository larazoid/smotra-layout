import type { App } from './app';
import { EVENT, slotLabel } from './event';
import { downloadBlob, esc, formatBytes, toast } from './util';

/**
 * "Pošalji organizatoru": the site is static, so we can't send mail ourselves.
 * Step 1 downloads the ZIP, step 2 opens the user's mail with everything filled in
 * except the attachment (or attaches it directly where the browser can share files).
 */
export class SendDialog {
  private readonly modal = document.getElementById('send')!;
  private zip: { blob: Blob; filename: string } | null = null;

  constructor(private readonly app: App) {
    this.modal.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.modal || t.closest('[data-close]')) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    this.$('#send-download').addEventListener('click', () => void this.download());
    this.$('#send-share').addEventListener('click', () => void this.share());
    this.$('#send-copy').addEventListener('click', () => void this.copy());
  }

  get isOpen() {
    return !this.modal.hidden;
  }

  open() {
    if (!this.app.readyToSend()) return;
    this.zip = null;
    this.render();
    this.modal.hidden = false;
  }

  close() {
    this.modal.hidden = true;
  }

  private $<T extends HTMLElement = HTMLElement>(sel: string) {
    return this.modal.querySelector<T>(sel)!;
  }

  private message() {
    const ex = this.app.store.doc.exhibitor;
    const f = this.app.faculty!;
    const filename = this.app.zipFilename();
    const subject = `${EVENT.name} ${EVENT.year} – raspored štanda – ${f.name}`;
    const contact = [ex.contact, ex.email].filter(Boolean).join(', ');
    const body = [
      'Poštovani,',
      '',
      `u privitku šaljemo raspored štanda i materijale za ${EVENT.nameAcc} ${EVENT.year}.`,
      '',
      `Sastavnica: ${f.name}`,
      `Termin: ${slotLabel(f)}`,
      contact ? `Kontakt: ${contact}` : '',
      `Datoteka: ${filename}`,
      '',
      'Lijep pozdrav',
    ]
      .filter((l, i, a) => l !== '' || a[i - 1] !== '')
      .join('\n');
    return { subject, body, filename };
  }

  private render() {
    const to = EVENT.organizerEmail;
    const { subject, body, filename } = this.message();
    const enc = encodeURIComponent;

    this.$('#send-filename').textContent = filename;
    this.$('#send-done').hidden = true;
    this.$('#send-step1').classList.remove('done');
    this.$('#send-address').innerHTML = to ? esc(to) : '<span class="missing">adresa još nije postavljena</span>';
    this.$<HTMLButtonElement>('#send-copy').disabled = !to;

    this.$<HTMLAnchorElement>('#send-mailto').href = `mailto:${to}?subject=${enc(subject)}&body=${enc(body)}`;
    this.$<HTMLAnchorElement>('#send-gmail').href = `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
    this.$<HTMLAnchorElement>('#send-outlook').href = `https://outlook.office.com/mail/deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`;

    // Some browsers (Safari, phones, Chrome on Windows) can hand the file straight to the mail app.
    const probe = new File([new Blob(['x'])], filename, { type: 'application/zip' });
    const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
    this.$('#send-share-row').hidden = !canShare;
  }

  private async build() {
    if (this.zip) return this.zip;
    const btn = this.$<HTMLButtonElement>('#send-download');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Pripremam…';
    try {
      this.zip = await this.app.makeZip();
      return this.zip;
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  private async download() {
    try {
      const zip = await this.build();
      downloadBlob(zip.blob, zip.filename);
      const big = zip.blob.size > EVENT.maxEmailMb * 1024 * 1024;
      const done = this.$('#send-done');
      done.hidden = false;
      done.className = big ? 'send-done big' : 'send-done';
      done.innerHTML = big
        ? `✓ Preuzeto: <b>${esc(zip.filename)}</b> (${formatBytes(zip.blob.size)}). Datoteka je prevelika za većinu e-mail poslužitelja — pošaljite je putem <a href="https://wetransfer.com" target="_blank" rel="noopener">WeTransfera</a> na istu adresu.`
        : `✓ Preuzeto: <b>${esc(zip.filename)}</b> (${formatBytes(zip.blob.size)}). Nalazi se u mapi Preuzimanja (Downloads).`;
      this.$('#send-step1').classList.add('done');
    } catch (e) {
      console.error(e);
      toast('Izrada ZIP-a nije uspjela. Pokušajte ponovno.', 'error');
    }
  }

  private async share() {
    try {
      const zip = await this.build();
      const { subject, body } = this.message();
      const file = new File([zip.blob], zip.filename, { type: 'application/zip' });
      await navigator.share({ files: [file], title: subject, text: body });
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast('Dijeljenje nije uspjelo. Preuzmite ZIP i priložite ga ručno.', 'error');
    }
  }

  private async copy() {
    try {
      await navigator.clipboard.writeText(EVENT.organizerEmail);
      toast('Adresa je kopirana.', 'ok');
    } catch {
      toast(`Adresa: ${EVENT.organizerEmail}`);
    }
  }
}
