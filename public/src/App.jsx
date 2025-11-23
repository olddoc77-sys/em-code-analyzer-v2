import { useState } from 'react';
import { FileText, AlertCircle, CheckCircle, Clock, Brain, Download } from 'lucide-react';

const MDM_CRITERIA = {
  problems: {
    straightforward: ['self-limited', 'minor problem'],
    low: ['stable chronic', 'acute uncomplicated'],
    moderate: ['multiple chronic', 'exacerbation', 'progression', 'undiagnosed new problem', 'uncertain prognosis'],
    high: ['severe exacerbation', 'threat to life', 'life-threatening']
  },
  data: {
    straightforward: [],
    low: ['review external note', 'review test result'],
    moderate: ['multiple unique tests', 'independent interpretation', 'discussion with', 'consult'],
    high: ['extensive data', 'multiple sources']
  },
  risk: {
    straightforward: ['otc', 'reassurance'],
    low: ['minor procedure'],
    moderate: ['prescription drug management', 'minor surgery'],
    high: ['hospitalization', 'emergency surgery']
  }
};

const TIME_THRESHOLDS = {
  new: [
    { code: '99202', level: 'Straightforward', min: 15, value: 0 },
    { code: '99203', level: 'Low', min: 30, value: 1 },
    { code: '99204', level: 'Moderate', min: 45, value: 2 },
    { code: '99205', level: 'High', min: 60, value: 3 }
  ],
  established: [
    { code: '99212', level: 'Straightforward', min: 10, value: 0 },
    { code: '99213', level: 'Low', min: 20, value: 1 },
    { code: '99214', level: 'Moderate', min: 30, value: 2 },
    { code: '99215', level: 'High', min: 40, value: 3 }
  ]
};

const CODE_MAP = {
  new: { straightforward: '99202', low: '99203', moderate: '99204', high: '99205' },
  established: { straightforward: '99212', low: '99213', moderate: '99214', high: '99215' }
};

const MDM_VALUES = { straightforward: 0, low: 1, moderate: 2, high: 3 };

export default function EMCodeAnalyzer() {
  const [note, setNote] = useState('');
  const [patientType, setPatientType] = useState('established');
  const [result, setResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [medicareMode, setMedicareMode] = useState(false);

  const extractTime = (text) => {
    const patterns = [/total\s*time[^0-9]*(\d+)/i, /time\s*spent[^0-9]*(\d+)/i];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return parseInt(m[1]);
    }
    return null;
  };

  const analyzeLevel = (text, criteria) => {
    const lower = text.toLowerCase();
    let best = 'straightforward';
    let matches = [];

    for (const [level, keywords] of Object.entries(criteria)) {
      const found = keywords.filter(k => lower.includes(k.toLowerCase()));
      if (found.length > 0 && MDM_VALUES[level] > MDM_VALUES[best]) {
        best = level;
        matches = found;
      }
    }
    return { level: best, matches, score: MDM_VALUES[best] };
  };

  const determineMDM = (p, d, r) => {
    const scores = [p.score, d.score, r.score];
    scores.sort((a, b) => b - a);
    const second = scores[1];
    return Object.keys(MDM_VALUES).find(k => MDM_VALUES[k] === second);
  };

  const getCodeByTime = (minutes, type) => {
    const thresholds = TIME_THRESHOLDS[type];
    let selected = thresholds.find(t => minutes >= t.min) || thresholds[0];
    let prolongedUnits = 0;
    const base = medicareMode ? (type === 'new' ? 88 : 68) : (type === 'new' ? 74 : 54);
    const excess = minutes - base;
    if (excess > 0) {
      prolongedUnits = Math.ceil(excess / 15);
      selected = thresholds[thresholds.length - 1];
    }
    return { selected, prolongedUnits };
  };

  const analyzeNote = () => {
    if (!note.trim()) return;
    setAnalyzing(true);
    setTimeout(() => {
      const problems = analyzeLevel(note, MDM_CRITERIA.problems);
      const data = analyzeLevel(note, MDM_CRITERIA.data);
      const risk = analyzeLevel(note, MDM_CRITERIA.risk);

      const mdmLevel = determineMDM(problems, data, risk);
      const mdmCode = CODE_MAP[patientType][mdmLevel];
      const mdmValue = MDM_VALUES[mdmLevel];

      const extractedTime = extractTime(note);
      let timeResult = null;
      let timeValue = -1;

      if (extractedTime) {
        const { selected, prolongedUnits } = getCodeByTime(extractedTime, patientType);
        timeResult = { ...selected, minutes: extractedTime, prolongedUnits };
        timeValue = selected.value;
      }

      const useTime = timeResult && timeValue > mdmValue;
      const finalCode = useTime ? timeResult.code : mdmCode;
      const finalMethod = useTime ? 'time' : 'mdm';
      const finalLevel = useTime ? timeResult.level : mdmLevel.charAt(0).toUpperCase() + mdmLevel.slice(1);

      setResult({
        finalCode, finalMethod, finalLevel, patientType,
        mdm: { problems, data, risk, level: mdmLevel, code: mdmCode, value: mdmValue },
        time: timeResult,
        belowMinimum: extractedTime && extractedTime < (patientType === 'new' ? 15 : 10),
        comparison: timeResult ? { mdmValue, timeValue, winner: useTime ? 'time' : 'mdm', equal: mdmValue === timeValue } : null
      });
      setAnalyzing(false);
    }, 400);
  };

  const exportResult = () => {
    if (!result) return;
    const prolongedCode = medicareMode ? 'G2212' : '99417';
    const text = `E/M Code Analysis - ${new Date().toLocaleDateString()}
----------------------------------------
Patient Type : ${result.patientType === 'new' ? 'New' : 'Established'}
Payer        : ${medicareMode ? 'Medicare' : 'Commercial'}

RECOMMENDED CODE: ${result.finalCode}${result.time?.prolongedUnits > 0 ? ` + ${prolongedCode} x ${result.time.prolongedUnits}` : ''}
Method       : ${result.finalMethod.toUpperCase()}
Level        : ${result.finalLevel}

MDM Breakdown
  Problems : ${result.mdm.problems.level} — ${result.mdm.problems.matches.join(', ') || 'none'}
  Data     : ${result.mdm.data.level} — ${result.mdm.data.matches.join(', ') || 'none'}
  Risk     : ${result.mdm.risk.level} — ${result.mdm.risk.matches.join(', ') || 'none'}

Time Documented: ${result.time ? `${result.time.minutes} minutes → ${result.time.code}` : 'None'}

Note Preview:
${note.trim().substring(0, 500)}${note.length > 500 ? '...' : ''}

----------------------------------------
Generated by E/M Code Analyzer • 2025 Guidelines • Educational use only
`;

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EM-Analysis-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const LevelBadge = ({ level }) => {
    const colors = {
      straightforward: 'bg-gray-100 text-gray-700',
      low: 'bg-blue-100 text-blue-700',
      moderate: 'bg-yellow-100 text-yellow-700',
      high: 'bg-red-100 text-red-700'
    };
    const display = level === 'straightforward' ? 'Straightforward' : level.charAt(0).toUpperCase() + level.slice(1);
    return <span className={`px-2.5 py-1 rounded text-sm font-semibold ${colors[level]}`}>{display}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-800">E/M Code Analyzer</h1>
              <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-medium">2025 Guidelines</span>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              <strong>Educational tool only.</strong> Always confirm with certified coder and official AMA/CMS guidelines.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={patientType === 'new'} onChange={() => setPatientType('new')} className="w-4 h-4 text-blue-600" />
                <span className="font-medium">New Patient</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={patientType === 'established'} onChange={() => setPatientType('established')} className="w-4 h-4 text-blue-600" />
                <span className="font-medium">Established Patient</span>
              </label>
            </div>
            <label className="flex items-center gap-2 cursor-pointer bg-gray-100 px-4 py-2 rounded-lg">
              <input type="checkbox" checked={medicareMode} onChange={(e) => setMedicareMode(e.target.checked)} className="w-4 h-4 text-blue-600" />
              <span className="font-medium">Medicare (G2212)</span>
            </label>
          </div>

          {/* BIG NOTE BOX */}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Paste your clinical note here..."
            className="w-full h-96 p-6 border-2 border-gray-300 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-600 font-mono text-base resize-none transition-all"
          />

          <div className="flex gap-3 mt-4">
            <button onClick={analyzeNote} disabled={!note.trim() || analyzing}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-xl font-medium transition">
              {analyzing ? 'Analyzing...' : 'Analyze Note'}
            </button>
            <button onClick={() => { setNote(''); setResult(null); }} className="px-5 py-3 border border-gray-300 hover:bg-gray-50 rounded-xl transition">Clear</button>
          </div>
        </div>

        {result && (
          <>
            <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                  <h2 className="text-2xl font-bold">Recommended Code</h2>
                </div>
                <button onClick={exportResult} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition">
                  <Download className="w-4 h-4" /> Export
                </button>
              </div>

              <div className="text-center py-10 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border-2 border-green-200">
                <p className="text-green-700 text-lg mb-2">Suggested CPT Code</p>
                <p className="text-7xl font-bold text-green-800 mb-4">{result.finalCode}</p>
                <p className="text-green-700 mt-5 text-lg">
                  {result.patientType === 'new' ? 'New' : 'Established'} Patient • {result.finalMethod.toUpperCase()}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-8">
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <Brain className="w-7 h-7 text-blue-600" /> MDM Details
              </h3>
              <div className="space-y-5">
                {[
                  { label: 'Problems Addressed', key: 'problems' },
                  { label: 'Data Reviewed / Ordered', key: 'data' },
                  { label: 'Risk of Complications', key: 'risk' }
                ].map(({ label, key }) => (
                  <div key={key} className="border rounded-2xl p-5 bg-gray-50">
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-semibold text-gray-800">{label}</span>
                      <LevelBadge level={result.mdm[key].level} />
                    </div>
                    <p className="text-sm text-gray-600">
                      {result.mdm[key].matches.length ? result.mdm[key].matches.join(' • ') : 'No indicators detected'}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-6 italic">
                MDM level = second-highest of the three elements (AMA 2025 guideline)
              </p>
            </div>

            <button
              onClick={() => { setNote(''); setResult(null); }}
              className="w-full mt-10 py-5 bg-blue-600 hover:bg-blue-700 text-white text-xl font-semibold rounded-2xl flex items-center justify-center gap-3 transition"
            >
              <FileText className="w-7 h-7" /> Next Patient
            </button>
          </>
        )}

        <div className="mt-12 text-center text-xs text-gray-500">
          Office/Outpatient E/M Only (99202–99215) • AMA CPT® 2025 Guidelines • Educational use only •{' '}
          <a href="https://www.ama-assn.org" target="_blank" rel="noopener noreferrer" className="underline">AMA</a> |{' '}
          <a href="https://www.cms.gov" target="_blank" rel="noopener noreferrer" className="underline">CMS</a>
        </div>
      </div>
    </div>
  );
}
