import { ImageResponse } from 'next/og';

// Imagen OpenGraph generada (1200x630 PNG) con la identidad PlacaPe.
export const alt = 'PlacaPe — Consulta de placa e historial vehicular en Perú';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          backgroundColor: '#0A2E3D',
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Logo tipo placa */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            alignSelf: 'flex-start',
            backgroundColor: '#FFFFFF',
            border: '5px solid #07222E',
            borderRadius: '22px',
            padding: '22px 36px',
          }}
        >
          <div style={{ display: 'flex', fontSize: '76px', fontWeight: 700, color: '#14506B' }}>placa</div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: '6px',
              fontSize: '76px',
              fontWeight: 700,
              color: '#16B5A3',
            }}
          >
            pe
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: '54px',
            maxWidth: '1000px',
            fontSize: '60px',
            fontWeight: 700,
            lineHeight: 1.1,
            color: '#FFFFFF',
          }}
        >
          Consulta de placa e historial vehicular en Peru
        </div>
        <div style={{ display: 'flex', marginTop: '28px', fontSize: '30px', color: '#A8E9E0' }}>
          Gratis y con enlaces oficiales: SUNARP, SBS, APESEG, MTC, SUNAT, SAT
        </div>
      </div>
    ),
    { ...size },
  );
}
