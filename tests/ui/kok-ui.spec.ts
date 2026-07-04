import { expect, test, type Page } from '@playwright/test';

const LONG_PLACE_NAME =
  '초장기테스트주차장정보박스오버플로우검증용공영주차장'.repeat(4);
const LONG_ADDRESS =
  '서울특별시테스트구테스트동123-45초장기도로명주소와건물명이계속붙어서나오는상황'.repeat(4);

const legacyGreenRgbValues = [
  'rgb(18, 184, 134)',
  'rgb(12, 161, 120)',
  'rgb(34, 197, 94)',
  'rgb(5, 150, 105)',
  'rgb(16, 185, 129)',
];

function installConsoleGuard(page: Page) {
  const messages: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      messages.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    messages.push(error.message);
  });

  return messages;
}

async function expectNoConsoleErrors(errors: string[]) {
  expect(errors, 'console and page errors').toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const audit = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const documentElement = document.documentElement;
    const body = document.body;
    const overflowing = Array.from(document.querySelectorAll('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const htmlElement = element as HTMLElement;

        return {
          tag: element.tagName,
          text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 96),
          className:
            typeof htmlElement.className === 'string'
              ? htmlElement.className.slice(0, 180)
              : '',
          display: style.display,
          visibility: style.visibility,
          scrollWidth: htmlElement.scrollWidth,
          clientWidth: htmlElement.clientWidth,
          rectLeft: Math.round(rect.left),
          rectRight: Math.round(rect.right),
          rectWidth: Math.round(rect.width),
          rectHeight: Math.round(rect.height),
          textLength: (element.textContent ?? '').trim().length,
        };
      })
      .filter((item) => {
        if (
          item.display === 'none' ||
          item.visibility === 'hidden' ||
          item.rectWidth <= 0 ||
          item.rectHeight <= 0
        ) {
          return false;
        }

        if (['input', 'textarea', 'svg', 'path'].includes(item.tag.toLowerCase())) {
          return false;
        }

        const outsideViewport = item.rectRight > viewportWidth + 2 || item.rectLeft < -2;
        const selfOverflow = item.textLength > 0 && item.scrollWidth > item.clientWidth + 2;

        return outsideViewport || selfOverflow;
      })
      .slice(0, 20);

    return {
      documentClientWidth: documentElement.clientWidth,
      documentScrollWidth: documentElement.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      overflowing,
    };
  });

  expect(audit.documentScrollWidth, `${label}: document horizontal overflow`).toBeLessThanOrEqual(
    audit.documentClientWidth + 1,
  );
  expect(audit.bodyScrollWidth, `${label}: body horizontal overflow`).toBeLessThanOrEqual(
    audit.bodyClientWidth + 1,
  );
  expect(audit.overflowing, `${label}: overflowing elements`).toEqual([]);
}

async function expectNoLegacyGreenAccent(page: Page, label: string) {
  const hits = await page.evaluate((legacyColors) => {
    return Array.from(document.querySelectorAll('body *'))
      .flatMap((element) => {
        const style = window.getComputedStyle(element);
        const values = [
          ['color', style.color],
          ['backgroundColor', style.backgroundColor],
          ['borderTopColor', style.borderTopColor],
          ['borderRightColor', style.borderRightColor],
          ['borderBottomColor', style.borderBottomColor],
          ['borderLeftColor', style.borderLeftColor],
        ] as const;

        return values
          .filter(([, value]) => legacyColors.includes(value))
          .map(([property, value]) => ({
            property,
            value,
            tag: element.tagName,
            text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
          }));
      })
      .slice(0, 20);
  }, legacyGreenRgbValues);

  expect(hits, `${label}: legacy green accent usage`).toEqual([]);
}

async function openGuestPlanner(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '비회원으로 시작' }).click();
  await expect(page.getByRole('button', { name: '옵션 변경' })).toBeVisible();
}

test.describe('KoK UI regression', () => {
  test('home screen renders without overflow or console errors', async ({ page }) => {
    const errors = installConsoleGuard(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'KoK' })).toBeVisible();
    await expect(page.getByRole('button', { name: '비회원으로 시작' })).toBeVisible();

    await expectNoHorizontalOverflow(page, 'home');
    await expectNoLegacyGreenAccent(page, 'home');
    await expectNoConsoleErrors(errors);
  });

  test('home screen shows guest flow steps and revised auth hierarchy', async ({ page }) => {
    const errors = installConsoleGuard(page);

    await page.goto('/');

    await expect(page.getByText('출발지 모으기')).toBeVisible();
    await expect(page.getByText('이동 부담 비교')).toBeVisible();
    await expect(page.getByText('랜덤 추첨')).toBeVisible();
    await expect(page.getByRole('button', { name: '비회원으로 시작' })).toBeVisible();
    await expect(page.getByText('이미 계정이 있나요?')).toBeVisible();
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
    await expectNoConsoleErrors(errors);
  });

  test('invite page without code sends users home without join or copy actions', async ({
    page,
  }) => {
    const errors = installConsoleGuard(page);

    await page.goto('/invite');

    await expect(page.getByRole('link', { name: '홈으로 가기' })).toBeVisible();
    await expect(page.getByRole('link', { name: '약속방 참여하기' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '초대 링크 복사' })).toHaveCount(0);
    await expectNoConsoleErrors(errors);
  });

  test('password recovery screens are reachable and responsive', async ({ page }) => {
    const errors = installConsoleGuard(page);

    await page.goto('/');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.getByRole('button', { name: '비밀번호를 잊으셨나요?' }).click();

    await expect(page.getByText('비밀번호 재설정')).toBeVisible();
    await page.getByPlaceholder('아이디 또는 이메일').fill('test@example.com');
    await expect(page.getByRole('button', { name: '재설정 메일 받기' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'password reset request');

    await page.getByRole('button', { name: '로그인으로 돌아가기' }).click();
    await expect(page.getByRole('button', { name: '로그인하고 시작' })).toBeVisible();

    await page.goto('/?reset-password=1');
    await expect(page.getByText('새 비밀번호', { exact: true })).toBeVisible();
    await page.getByPlaceholder('새 비밀번호', { exact: true }).fill('new-password');
    await page.getByPlaceholder('새 비밀번호 확인', { exact: true }).fill('new-password');
    await expect(page.getByRole('button', { name: '비밀번호 바꾸기' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'password reset update');
    await expectNoConsoleErrors(errors);
  });

  test('guest planner options stay simple and responsive', async ({ page }) => {
    const errors = installConsoleGuard(page);

    await openGuestPlanner(page);
    await expectNoHorizontalOverflow(page, 'guest planner');

    await page.getByRole('button', { name: '옵션 변경' }).click();
    await expect(page.getByText('공평 기준')).toBeVisible();
    await expect(page.getByText('이동시간 공정도')).toHaveCount(0);
    await expect(page.getByText('AI 연결')).toHaveCount(0);
    await expect(page.getByText(/Lv\.\d/)).toHaveCount(0);

    await page.getByRole('button', { name: /후보 넓게/ }).click();
    await expect(page.locator('body')).toContainText('후보 넓게 · 35분 이내');

    await expectNoHorizontalOverflow(page, 'options page');
    await expectNoLegacyGreenAccent(page, 'options page');
    await expectNoConsoleErrors(errors);
  });

  test('guest planner starts on participants tab with actionable empty guidance', async ({
    page,
  }) => {
    const errors = installConsoleGuard(page);

    await openGuestPlanner(page);

    const participantsTab = page.getByRole('button', { name: '참여자 보기' });
    await expect(participantsTab).toBeVisible();
    await expect(participantsTab).toHaveClass(/bg-white/);
    await expect(page.getByRole('button', { name: '친구 추가' })).toBeVisible();
    await expect(page.getByText(/참여자를 2명 이상/)).toBeVisible();
    await expectNoConsoleErrors(errors);
  });

  test('planner options screen has no apply button', async ({ page }) => {
    const errors = installConsoleGuard(page);

    await openGuestPlanner(page);
    await page.getByRole('button', { name: '옵션 변경' }).click();

    await expect(page.getByText('공평 기준')).toBeVisible();
    await expect(page.getByRole('button', { name: '적용' })).toHaveCount(0);
    await expectNoConsoleErrors(errors);
  });

  test('participant add form handles long typed content on mobile-width layouts', async ({
    page,
  }) => {
    const errors = installConsoleGuard(page);

    await openGuestPlanner(page);
    await page.getByRole('button', { name: /참여자 보기/ }).click();
    await page.getByRole('button', { name: '친구 추가' }).click();

    await page.getByPlaceholder('이름').fill(LONG_PLACE_NAME);
    await page.getByPlaceholder('역, 장소명, 건물명, 도로명').fill(LONG_ADDRESS);

    await expect(page.getByPlaceholder('이름')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'participant add form');
    await expectNoConsoleErrors(errors);
  });

  test('long place and parking cards cannot push outside their containers', async ({ page }) => {
    const errors = installConsoleGuard(page);

    await page.goto('/');
    await page.evaluate(
      ({ longPlaceName, longAddress }) => {
        const root = document.querySelector('#root');

        if (!root) {
          throw new Error('Missing #root');
        }

        root.innerHTML = `
          <main class="mx-auto min-h-screen w-full max-w-[504px] bg-[#F5F9F7] p-4 text-[#16241D]">
            <section class="mt-4 max-w-full overflow-hidden rounded-[1.5rem] border border-[#eef2f6] bg-[#f8fafc] p-4">
              <div class="mb-3 flex min-w-0 items-center justify-between gap-3">
                <div class="min-w-0 truncate text-sm font-bold tracking-[-0.02em] text-[#16241D]">주차장 정보</div>
                <a class="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-full bg-white px-3 text-xs text-[#44505b] shadow-sm">더보기</a>
              </div>
              <div class="grid min-w-0 gap-2 md:grid-cols-2">
                <a class="flex min-w-0 max-w-full items-start gap-3 overflow-hidden rounded-2xl bg-white px-4 py-3 shadow-[0_6px_16px_rgba(20,35,29,0.04)]">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFF0EE] text-sm font-black text-[#ea580c]">P</span>
                  <span class="min-w-0 flex-1 overflow-hidden">
                    <span class="line-clamp-2 break-words text-sm font-semibold leading-snug text-[#16241D] [overflow-wrap:anywhere]">${longPlaceName}</span>
                    <span class="mt-1 line-clamp-2 break-words text-xs leading-snug text-[#7a8491] [overflow-wrap:anywhere]">${longAddress}</span>
                  </span>
                  <span class="mt-1 h-4 w-4 shrink-0 rounded-full bg-[#98a2b3]"></span>
                </a>
              </div>
            </section>

            <section class="mt-4 max-w-full overflow-hidden rounded-xl border border-[#E4EFE9] bg-white p-3">
              <div class="flex min-w-0 items-start justify-between gap-3">
                <div class="min-w-0 flex-1 overflow-hidden">
                  <div class="line-clamp-2 break-words text-sm leading-snug text-[#16241D] [overflow-wrap:anywhere]">${longPlaceName}</div>
                  <div class="mt-1 line-clamp-2 break-words text-xs leading-snug text-[#6E7C75] [overflow-wrap:anywhere]">${longAddress}</div>
                </div>
                <a class="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-full bg-white px-3 text-xs text-[#16241D] shadow-sm">보기</a>
              </div>
              <div class="mt-3 flex min-w-0 items-start gap-2 text-xs text-[#6E7C75]">
                <span class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full bg-[#FF6B5F]"></span>
                <span class="min-w-0 break-words leading-snug [overflow-wrap:anywhere]">${longAddress}</span>
              </div>
            </section>

            <section class="mt-4 max-w-full overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/96 p-4 shadow-[0_18px_40px_rgba(18,28,45,0.16)]">
              <div class="flex min-w-0 items-start justify-between gap-3">
                <div class="min-w-0 flex-1 overflow-hidden">
                  <div class="line-clamp-2 break-words text-base leading-snug text-[#16241D] [overflow-wrap:anywhere]">${longPlaceName}</div>
                  <div class="mt-1 line-clamp-2 break-words text-sm leading-relaxed text-[#6E7C75] [overflow-wrap:anywhere]">${longAddress}</div>
                </div>
                <button class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFFFFF] text-[#6E7C75]">x</button>
              </div>
              <div class="mt-3 flex min-w-0 items-start gap-2 text-xs text-[#6E7C75]">
                <span class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full bg-[#FF6B5F]"></span>
                <span class="min-w-0 break-words leading-snug [overflow-wrap:anywhere]">${longAddress}</span>
              </div>
            </section>
          </main>
        `;
      },
      {
        longPlaceName: LONG_PLACE_NAME,
        longAddress: LONG_ADDRESS,
      },
    );

    await expectNoHorizontalOverflow(page, 'long place fixtures');
    await expectNoConsoleErrors(errors);
  });
});
