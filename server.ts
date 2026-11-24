import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

type EyewearFrameMode = 'prescription' | 'sunglasses' | 'clip_on' | 'kids' | 'metal';
type EyewearSubMode = 'optical' | 'sun';

interface SplitSheetRequestBody {
  imageBase64?: unknown;
  mimeType?: unknown;
  frameType?: unknown;
  subCategory?: unknown;
  isClipOnAttachment?: unknown;
  lensWidthMm?: unknown;
  bridgeWidthMm?: unknown;
  templeLengthMm?: unknown;
  totalFrameWidthMm?: unknown;
}

interface ExtractDimensionsRequestBody {
  imageBase64?: unknown;
  mimeType?: unknown;
}

const ALLOWED_FRAME_MODES = new Set<EyewearFrameMode>([
  'prescription',
  'sunglasses',
  'clip_on',
  'kids',
  'metal',
]);

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function clampIntInRange(val: unknown, min: number, max: number): number | null {
  const num = typeof val === 'number' ? val : typeof val === 'string' && val.trim() ? Number(val) : NaN;
  if (!Number.isFinite(num)) return null;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('مفتاح Gemini API المدفوع غير مفعّل بعد — يرجى إضافته من Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function buildEyewearSplitSheetPrompt(params: {
  frameType: EyewearFrameMode;
  subCategory: EyewearSubMode;
  isClipOnAttachment: boolean;
  lensWidthMm?: number | null;
  bridgeWidthMm?: number | null;
  templeLengthMm?: number | null;
  totalFrameWidthMm?: number | null;
}): string {
  const isSun =
    params.frameType === 'sunglasses' ||
    params.subCategory === 'sun' ||
    params.isClipOnAttachment;

  const lensRule = isSun
    ? 'Keep the original dark, tinted, gradient, or mirrored sunglasses lenses 100% intact with their natural color, density, and tint across BOTH halves.'
    : 'In the LEFT HALF, BOTH lens openings MUST be 100% hollow and empty showing ONLY the exact flat chroma-key background color inside the rims (completely remove stands, bottle caps, table surfaces, reflections, and folded side temples visible behind the lenses).';

  const metalRule =
    params.frameType === 'metal'
      ? 'This is a metal / half-rim / rimless frame: keep thin ~1mm metal wires, bridges, and nose-pad arms razor-sharp and crisp without eroding them, and render clean polished glass bevel edges along frameless/half-rim lenses.'
      : '';

  const clipOnRule =
    params.frameType === 'clip_on'
      ? params.isClipOnAttachment
        ? 'Accurately preserve the attached magnetic dark sun clip-on visor mounted securely on top of the optical frame across BOTH halves.'
        : 'Show ONLY the base optical frame without any magnetic clip-on attached across BOTH halves.'
      : '';

  const kidsRule =
    params.frameType === 'kids'
      ? 'Preserve the compact pediatric eyewear proportions cleanly.'
      : '';

  const opticalSizeRule =
    params.lensWidthMm && params.bridgeWidthMm && params.templeLengthMm
      ? `PHYSICAL PROPORTION ACCURACY: Maintain true-to-scale physical geometry matching ${params.lensWidthMm}mm lens width, ${params.bridgeWidthMm}mm nose bridge gap, and ${params.templeLengthMm}mm temple arm length (total frame front width ~${params.totalFrameWidthMm || 2 * params.lensWidthMm + params.bridgeWidthMm + 10}mm) across both halves.`
      : '';

  return [
    'Generate a single ultra-clean 16:9 horizontal split-screen product studio sheet divided strictly at the exact vertical center (x = 50% width), with ZERO dividing line, ZERO border, ZERO text, ZERO labels, and ZERO watermark.',
    '',
    'LEFT HALF (0% to 50% width — Virtual Try-On Orthographic Front Cutout Base):',
    '- Show a strict flat 100% straight orthographic front view of ONLY the front face of the eyewear frame from the input photo, with both side temples/arms completely folded and hidden behind the front frame.',
    '- Center the eyewear horizontally and vertically inside the LEFT HALF only (leaving clean margin inside 0%..50% so nothing crosses x = 50%).',
    '- Place it on a completely flat, solid, uniform Chroma-Key studio color filling the entire LEFT HALF:',
    '  * Use solid pure #0000FF blue if the frame is clear, transparent, white, silver, or light metal;',
    '  * Use solid pure #00FF00 green if the frame is dark, black, brown, tortoiseshell, gold, or colored;',
    '  * Use solid pure #FF00FF magenta ONLY if the frame itself is green.',
    '- ZERO gradients, ZERO shadows, and ZERO highlights on the left-half background.',
    `- ${lensRule}`,
    '',
    'RIGHT HALF (50% to 100% width — 3/4 Three-Quarter Side Studio Catalog Shot):',
    '- Re-render the EXACT SAME eyewear frame from a ~35-degree 3/4 three-quarter side perspective angle facing slightly toward the center-left, clearly showing the open full side temple/arm, hinge hardware, nose pads, and curved ear tip.',
    '- Center the 3/4 view cleanly inside the RIGHT HALF (50%..100%) on a completely solid #F8F9FA snow-white studio background with even Warby Parker-style lighting and a soft, realistic natural studio contact shadow directly beneath the bottom rims and temple tips.',
    '',
    'STRICT COLOR & MATERIAL PRESERVATION RULES:',
    '- Preserve 100% of the exact original RGB color, shade, finish, opacity, and solid vs. patterned surface from the input photo.',
    '- If the input frame is crystal clear/transparent acetate, keep it pure neutral crystal clear with ZERO blue color cast or tint.',
    '- NEVER invent tortoiseshell or marbled patterns on solid-color frames, and never alter metallic gold/silver/gunmetal tones.',
    '- Completely remove all props, stands, hands, tables, walls, and clutter from the input photo.',
    opticalSizeRule,
    metalRule,
    clipOnRule,
    kidsRule,
  ]
    .filter(Boolean)
    .join('\n');
}

export function createEyewearServerApp() {
  const app = express();
  app.use(express.json({ limit: '16mb' }));

  app.post('/api/eyewear/extract-dimensions', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as ExtractDimensionsRequestBody;
      const rawBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      const rawMime = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'image/jpeg';

      if (!rawBase64) {
        res.status(400).json({ error: 'بيانات الصورة مفقودة في الطلب' });
        return;
      }

      const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      if (cleanBase64.length > 20_000_000) {
        res.status(413).json({ error: 'حجم الصورة يتجاوز الحد المسموح به (15MB)' });
        return;
      }

      const safeMimeType = ALLOWED_MIME_TYPES.has(rawMime) ? rawMime : 'image/jpeg';
      const ai = getGeminiClient();

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: safeMimeType,
              },
            },
            {
              text: [
                'Inspect this eyewear photo carefully for any printed optical sizing specification on the inner temple arm, nose bridge, lens sticker, or price tag (standard format like 52□18-140, 50-19-142, 48[]17 135).',
                'Extract three integer millimeter values if clearly legible:',
                '- lens_width_mm (typically 35..70)',
                '- bridge_width_mm (typically 10..30)',
                '- temple_length_mm (typically 110..165)',
                'If the printed sizing numbers are missing, blurry, obscured, or absent, set found=false and return null for the unknown numbers. Never invent or guess numbers.',
              ].join('\n'),
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              found: { type: Type.BOOLEAN },
              lens_width_mm: { type: Type.INTEGER, nullable: true },
              bridge_width_mm: { type: Type.INTEGER, nullable: true },
              temple_length_mm: { type: Type.INTEGER, nullable: true },
              raw_text: { type: Type.STRING, nullable: true },
            },
            required: ['found'],
          },
        },
      });

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(response.text || '{}') as Record<string, unknown>;
      } catch {
        parsed = {};
      }

      const lens = clampIntInRange(parsed.lens_width_mm, 35, 70);
      const bridge = clampIntInRange(parsed.bridge_width_mm, 10, 30);
      const temple = clampIntInRange(parsed.temple_length_mm, 110, 165);
      const found = Boolean(parsed.found) && lens !== null && bridge !== null;

      res.json({
        ok: true,
        found,
        lens_width_mm: lens,
        bridge_width_mm: bridge,
        temple_length_mm: temple,
        total_frame_width_mm: lens !== null && bridge !== null ? 2 * lens + bridge + 10 : null,
        raw_text: typeof parsed.raw_text === 'string' ? parsed.raw_text.slice(0, 64) : null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'تعذّر فحص مقاسات النظارة عبر الخادم';
      const status = message.includes('GEMINI_API_KEY') || message.includes('Settings > Secrets') ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/eyewear/split-sheet', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as SplitSheetRequestBody;
      const rawBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      const rawMime = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'image/jpeg';

      if (!rawBase64) {
        res.status(400).json({ error: 'بيانات الصورة مفقودة في الطلب' });
        return;
      }

      const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      if (cleanBase64.length > 20_000_000) {
        res.status(413).json({ error: 'حجم الصورة يتجاوز الحد المسموح به (15MB)' });
        return;
      }

      const safeMimeType = ALLOWED_MIME_TYPES.has(rawMime) ? rawMime : 'image/jpeg';
      const frameType: EyewearFrameMode = ALLOWED_FRAME_MODES.has(body.frameType as EyewearFrameMode)
        ? (body.frameType as EyewearFrameMode)
        : 'prescription';
      const subCategory: EyewearSubMode = body.subCategory === 'sun' ? 'sun' : 'optical';
      const isClipOnAttachment = Boolean(body.isClipOnAttachment);
      const lensWidthMm = clampIntInRange(body.lensWidthMm, 35, 70);
      const bridgeWidthMm = clampIntInRange(body.bridgeWidthMm, 10, 30);
      const templeLengthMm = clampIntInRange(body.templeLengthMm, 110, 165);
      const totalFrameWidthMm =
        lensWidthMm && bridgeWidthMm
          ? 2 * lensWidthMm + bridgeWidthMm + 10
          : clampIntInRange(body.totalFrameWidthMm, 95, 175);

      const ai = getGeminiClient();
      const prompt = buildEyewearSplitSheetPrompt({
        frameType,
        subCategory,
        isClipOnAttachment,
        lensWidthMm,
        bridgeWidthMm,
        templeLengthMm,
        totalFrameWidthMm,
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: safeMimeType,
              },
            },
            {
              text: prompt,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: '16:9',
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      let splitImageBase64: string | null = null;
      let outMimeType = 'image/png';

      for (const part of parts) {
        if (part.inlineData?.data) {
          splitImageBase64 = part.inlineData.data;
          outMimeType = part.inlineData.mimeType || 'image/png';
          break;
        }
      }

      if (!splitImageBase64) {
        res.status(502).json({
          error: 'لم تُرجع خدمة الذكاء الاصطناعي صورة لوحة الاستوديو المزدوجة (16:9). حاول مجدداً.',
        });
        return;
      }

      res.json({
        splitImageBase64,
        mimeType: outMimeType,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'تعذر الاتصال بخدمة توليد صور الاستوديو';
      const status = message.includes('GEMINI_API_KEY') || message.includes('Settings > Secrets') ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  return app;
}

async function startServer() {
  const app = createEyewearServerApp();
  const isProd = process.env.NODE_ENV === 'production';
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`[OptiVerse] Full-stack server running on http://0.0.0.0:${port}`);
  });
}

const isEntrypoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  path.basename(process.argv[1]).startsWith('server.');

if (isEntrypoint) {
  void startServer();
}
