import {
  AudioLines,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Heart,
  Loader2,
  Mic,
  Pause,
  RotateCcw,
  Search,
  Send,
  Square,
  UserRound,
  Volume2,
} from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'

const VILLAGES = [
  '溪源村',
  '东溪村',
  '大岭村',
  '鲶坑村',
  '蒋坊村',
  '楚尾村',
  '桐荣村',
  '都团村',
  '上坪村',
]

const EMPTY_FORM = {
  hanzi: '',
  mandarin: '',
  pinyin: '',
  village: VILLAGES[0],
  villageCustom: '',
  contributor: '',
}

const tabs = [
  { id: 'record', label: '录音', icon: Mic },
  { id: 'library', label: '词库', icon: BookOpen },
  { id: 'search', label: '搜索', icon: Search },
  { id: 'stats', label: '统计', icon: BarChart3 },
]

const palette = {
  page: '#0E0C09',
  panel: '#161208',
  panelSoft: '#1d170d',
  border: '#2a2310',
  gold: '#D4AF37',
  goldSoft: '#B8A070',
  text: '#F0E6C8',
  dim: '#9f8b63',
  brown: '#7a6a4a',
  ink: '#080705',
  jade: '#88b28a',
  red: '#c76f55',
}

function todayString(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function cleanText(value) {
  return value.trim().replace(/\s+/g, ' ')
}

function safeFilePart(value) {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`]/g, '')
    .replace(/\s+/g, '-')
  return encodeURIComponent(cleaned || 'entry').slice(0, 80)
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.split(',')[1] : result)
    }
    reader.onerror = () => reject(new Error('录音读取失败，请重录一次。'))
    reader.readAsDataURL(blob)
  })
}

function formatSeconds(seconds) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function readLikedEntries() {
  try {
    return JSON.parse(localStorage.getItem('xiangyin-xiyuan-liked') || '[]')
  } catch {
    return []
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('record')
  const [entries, setEntries] = useState([])
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [waveBars, setWaveBars] = useState(Array.from({ length: 24 }, () => 12))
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [recorderError, setRecorderError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [villageFilter, setVillageFilter] = useState('全部')
  const [likedIds, setLikedIds] = useState(() => new Set(readLikedEntries()))

  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const chunksRef = useRef([])
  const intervalRef = useRef(null)
  const animationRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)

  useEffect(() => {
    let unsubscribe = () => undefined
    let cancelled = false

    import('./firebase')
      .then(({ subscribeToEntries }) => {
        if (cancelled) return
        unsubscribe = subscribeToEntries(
          (items) => {
            setEntries(items)
            setLoadingEntries(false)
            setLoadError('')
          },
          (error) => {
            setLoadError(error.message || '词库加载失败')
            setLoadingEntries(false)
          },
        )
      })
      .catch((error) => {
        if (cancelled) return
        setLoadError(error.message || '词库加载失败')
        setLoadingEntries(false)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    return () => {
      stopAudioGraph()
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [audioUrl])

  const stats = useMemo(() => {
    const villageCounts = new Map()
    const contributorCounts = new Map()

    entries.forEach((entry) => {
      const village = entry.villageLabel || entry.village || '未标注'
      villageCounts.set(village, (villageCounts.get(village) || 0) + 1)

      const contributor = entry.contributor || '匿名'
      contributorCounts.set(contributor, (contributorCounts.get(contributor) || 0) + 1)
    })

    return {
      total: entries.length,
      villageCovered: villageCounts.size,
      contributors: contributorCounts.size,
      villageCounts: Array.from(villageCounts.entries()).sort((a, b) => b[1] - a[1]),
      contributorsRank: Array.from(contributorCounts.entries()).sort((a, b) => b[1] - a[1]),
    }
  }, [entries])

  const filteredEntries = useMemo(() => {
    const keyword = normalize(searchText)

    return entries.filter((entry) => {
      const villageLabel = entry.villageLabel || entry.village || ''
      const textMatches =
        !keyword ||
        [entry.hanzi, entry.mandarin, entry.pinyin, villageLabel]
          .map(normalize)
          .some((value) => value.includes(keyword))
      const villageMatches = villageFilter === '全部' || villageLabel === villageFilter
      return textMatches && villageMatches
    })
  }, [entries, searchText, villageFilter])

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError('')
    setSuccessMessage('')
  }

  function stopAudioGraph() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }
    analyserRef.current = null
  }

  async function startRecording() {
    setRecorderError('')
    setFormError('')
    setSuccessMessage('')

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecorderError('当前浏览器不支持录音，请换用新版 Chrome、Edge 或 Safari。')
      return
    }

    try {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioBlob(null)
      setAudioUrl('')
      setRecordSeconds(0)

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType: preferredMime })
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const previewUrl = URL.createObjectURL(blob)
        setAudioBlob(blob)
        setAudioUrl(previewUrl)
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        stopAudioGraph()
        setRecording(false)
      }

      mediaRecorderRef.current = recorder
      setupAudioGraph(stream)
      recorder.start()
      setRecording(true)

      intervalRef.current = setInterval(() => {
        setRecordSeconds((current) => current + 1)
      }, 1000)
    } catch (error) {
      setRecorderError(error.message || '无法打开麦克风，请检查浏览器权限。')
      setRecording(false)
      stopAudioGraph()
    }
  }

  function setupAudioGraph(stream) {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return

    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 64
    source.connect(analyser)

    audioContextRef.current = audioContext
    analyserRef.current = analyser

    const data = new Uint8Array(analyser.frequencyBinCount)

    const animate = () => {
      analyser.getByteFrequencyData(data)
      const nextBars = Array.from({ length: 24 }, (_, index) => {
        const value = data[index % data.length] || 0
        return 8 + Math.round((value / 255) * 38)
      })
      setWaveBars(nextBars)
      animationRef.current = requestAnimationFrame(animate)
    }

    animate()
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  function clearRecording() {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl('')
    setRecordSeconds(0)
    setWaveBars(Array.from({ length: 24 }, () => 12))
    setRecorderError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')
    setSuccessMessage('')

    const hanzi = cleanText(form.hanzi)
    const mandarin = cleanText(form.mandarin)
    const villageCustom = cleanText(form.villageCustom)
    const villageLabel = form.village === '其他' ? villageCustom : form.village

    if (!hanzi || !mandarin || !villageLabel) {
      setFormError('请填写汉字、普通话释义和村庄。')
      return
    }

    setSubmitting(true)

    try {
      const createdAt = Date.now()
      let uploadedAudioUrl = null

      if (audioBlob) {
        const base64Audio = await blobToBase64(audioBlob)
        const uploadResponse = await fetch('/api/upload-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pathname: `audio/${createdAt}-${safeFilePart(hanzi)}.webm`,
            contentType: 'audio/webm',
            data: base64Audio,
          }),
        })

        const uploadResult = await uploadResponse.json()
        if (!uploadResponse.ok) {
          throw new Error(uploadResult.error || '录音上传失败')
        }

        uploadedAudioUrl = uploadResult.url
      }

      const { createEntry } = await import('./firebase')
      await createEntry({
        hanzi,
        mandarin,
        pinyin: cleanText(form.pinyin),
        village: form.village,
        villageCustom,
        villageLabel,
        contributor: cleanText(form.contributor) || '匿名',
        audioUrl: uploadedAudioUrl,
        likes: 0,
        timestamp: todayString(new Date(createdAt)),
        createdAt,
      })

      setForm(EMPTY_FORM)
      clearRecording()
      setSuccessMessage('词条已保存到乡音溪源。')
      setActiveTab('library')
    } catch (error) {
      setFormError(error.message || '提交失败，请稍后再试。')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLike(entryId) {
    if (likedIds.has(entryId)) return

    try {
      const { likeEntry } = await import('./firebase')
      await likeEntry(entryId)
      const next = new Set(likedIds)
      next.add(entryId)
      setLikedIds(next)
      localStorage.setItem('xiangyin-xiyuan-liked', JSON.stringify(Array.from(next)))
    } catch (error) {
      setLoadError(error.message || '点赞失败')
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.phoneFrame}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>溪源乡方言声音档案</p>
            <h1 style={styles.title}>乡音溪源</h1>
          </div>
          <div style={styles.headerSeal}>溪</div>
        </header>

        <div style={styles.content}>
          {activeTab === 'record' && (
            <RecordView
              form={form}
              formError={formError}
              successMessage={successMessage}
              submitting={submitting}
              recording={recording}
              recordSeconds={recordSeconds}
              waveBars={waveBars}
              audioUrl={audioUrl}
              recorderError={recorderError}
              onChange={updateForm}
              onSubmit={handleSubmit}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onClearRecording={clearRecording}
            />
          )}

          {activeTab === 'library' && (
            <LibraryView
              entries={entries}
              loading={loadingEntries}
              loadError={loadError}
              likedIds={likedIds}
              onLike={handleLike}
            />
          )}

          {activeTab === 'search' && (
            <SearchView
              entries={filteredEntries}
              searchText={searchText}
              villageFilter={villageFilter}
              likedIds={likedIds}
              onSearch={setSearchText}
              onVillageFilter={setVillageFilter}
              onLike={handleLike}
            />
          )}

          {activeTab === 'stats' && <StatsView stats={stats} />}
        </div>

        <nav style={styles.tabBar} aria-label="主导航">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.label}
                onClick={() => setActiveTab(tab.id)}
                style={{ ...styles.tabButton, ...(active ? styles.tabButtonActive : null) }}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                <span style={styles.tabLabel}>{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </section>
    </main>
  )
}

function RecordView({
  form,
  formError,
  successMessage,
  submitting,
  recording,
  recordSeconds,
  waveBars,
  audioUrl,
  recorderError,
  onChange,
  onSubmit,
  onStartRecording,
  onStopRecording,
  onClearRecording,
}) {
  return (
    <form onSubmit={onSubmit} style={styles.form}>
      <Field label="汉字" required>
        <input
          value={form.hanzi}
          onChange={(event) => onChange('hanzi', event.target.value)}
          placeholder="例：食饭"
          style={styles.input}
          maxLength={40}
        />
      </Field>

      <Field label="普通话释义" required>
        <textarea
          value={form.mandarin}
          onChange={(event) => onChange('mandarin', event.target.value)}
          placeholder="例：吃饭"
          style={{ ...styles.input, ...styles.textarea }}
          maxLength={160}
        />
      </Field>

      <div style={styles.twoColumn}>
        <Field label="村庄" required>
          <select
            value={form.village}
            onChange={(event) => onChange('village', event.target.value)}
            style={styles.input}
          >
            {VILLAGES.map((village) => (
              <option key={village}>{village}</option>
            ))}
            <option>其他</option>
          </select>
        </Field>

        <Field label="拼音 / 注音">
          <input
            value={form.pinyin}
            onChange={(event) => onChange('pinyin', event.target.value)}
            placeholder="可选"
            style={styles.input}
            maxLength={120}
          />
        </Field>
      </div>

      {form.village === '其他' && (
        <Field label="自然村名称" required>
          <input
            value={form.villageCustom}
            onChange={(event) => onChange('villageCustom', event.target.value)}
            placeholder="例：石坑自然村"
            style={styles.input}
            maxLength={60}
          />
        </Field>
      )}

      <Field label="贡献者姓名">
        <input
          value={form.contributor}
          onChange={(event) => onChange('contributor', event.target.value)}
          placeholder="留空则为匿名"
          style={styles.input}
          maxLength={40}
        />
      </Field>

      <section style={styles.recorderPanel}>
        <div style={styles.recorderTop}>
          <div>
            <p style={styles.sectionKicker}>方言发音</p>
            <strong style={styles.timer}>{formatSeconds(recordSeconds)}</strong>
          </div>
          {recording ? (
            <button
              type="button"
              title="停止录音"
              onClick={onStopRecording}
              style={{ ...styles.primaryButton, ...styles.stopButton }}
            >
              <Square size={18} fill="currentColor" />
              停止
            </button>
          ) : (
            <button
              type="button"
              title="开始录音"
              onClick={onStartRecording}
              style={styles.primaryButton}
            >
              <Mic size={18} />
              录音
            </button>
          )}
        </div>

        <div style={styles.waveWrap} aria-hidden="true">
          {waveBars.map((height, index) => (
            <span
              key={`${height}-${index}`}
              style={{
                ...styles.waveBar,
                height: `${recording ? height : audioUrl ? 18 + (index % 5) * 4 : 10}px`,
                opacity: recording || audioUrl ? 1 : 0.35,
              }}
            />
          ))}
        </div>

        {audioUrl && (
          <div style={styles.previewRow}>
            <audio src={audioUrl} controls style={styles.audioPlayer} />
            <button type="button" title="重录" onClick={onClearRecording} style={styles.iconButton}>
              <RotateCcw size={18} />
            </button>
          </div>
        )}

        {recorderError && <p style={styles.errorText}>{recorderError}</p>}
      </section>

      {formError && <p style={styles.errorText}>{formError}</p>}
      {successMessage && <p style={styles.successText}>{successMessage}</p>}

      <button type="submit" disabled={submitting || recording} style={styles.submitButton}>
        {submitting ? <Loader2 size={18} style={styles.spinIcon} /> : <Send size={18} />}
        {submitting ? '保存中' : '保存词条'}
      </button>
    </form>
  )
}

function LibraryView({ entries, loading, loadError, likedIds, onLike }) {
  if (loading) {
    return (
      <div style={styles.centerState}>
        <Loader2 size={24} style={styles.spinIcon} />
        <span>正在打开词库</span>
      </div>
    )
  }

  return (
    <section style={styles.stack}>
      <div style={styles.viewTitleRow}>
        <h2 style={styles.viewTitle}>词汇库</h2>
        <span style={styles.countPill}>{entries.length} 条</span>
      </div>
      {loadError && <p style={styles.errorText}>{loadError}</p>}
      {entries.length === 0 ? (
        <EmptyState text="还没有词条，先录下第一声乡音。" />
      ) : (
        entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            liked={likedIds.has(entry.id)}
            onLike={() => onLike(entry.id)}
          />
        ))
      )}
    </section>
  )
}

function SearchView({
  entries,
  searchText,
  villageFilter,
  likedIds,
  onSearch,
  onVillageFilter,
  onLike,
}) {
  return (
    <section style={styles.stack}>
      <div style={styles.searchPanel}>
        <label style={styles.searchBox}>
          <Search size={18} />
          <input
            value={searchText}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="汉字、释义、拼音、村名"
            style={styles.searchInput}
          />
        </label>
        <select
          value={villageFilter}
          onChange={(event) => onVillageFilter(event.target.value)}
          style={styles.input}
        >
          <option>全部</option>
          {VILLAGES.map((village) => (
            <option key={village}>{village}</option>
          ))}
        </select>
      </div>

      <div style={styles.viewTitleRow}>
        <h2 style={styles.viewTitle}>搜索结果</h2>
        <span style={styles.countPill}>{entries.length} 条</span>
      </div>

      {entries.length === 0 ? (
        <EmptyState text="没有匹配的词条。" />
      ) : (
        entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            liked={likedIds.has(entry.id)}
            onLike={() => onLike(entry.id)}
          />
        ))
      )}
    </section>
  )
}

function StatsView({ stats }) {
  const maxVillageCount = Math.max(1, ...stats.villageCounts.map(([, count]) => count))

  return (
    <section style={styles.stack}>
      <div style={styles.metricsGrid}>
        <Metric label="词汇总数" value={stats.total} />
        <Metric label="覆盖村落" value={stats.villageCovered} />
        <Metric label="贡献者" value={stats.contributors} />
      </div>

      <section style={styles.flatPanel}>
        <h2 style={styles.viewTitle}>各村词汇</h2>
        {stats.villageCounts.length === 0 ? (
          <EmptyState text="统计会在第一条词汇后出现。" />
        ) : (
          <div style={styles.chartList}>
            {stats.villageCounts.map(([village, count]) => (
              <div key={village} style={styles.chartRow}>
                <span style={styles.chartLabel}>{village}</span>
                <div style={styles.chartTrack}>
                  <span
                    style={{
                      ...styles.chartFill,
                      width: `${Math.max(8, (count / maxVillageCount) * 100)}%`,
                    }}
                  />
                </div>
                <strong style={styles.chartValue}>{count}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={styles.flatPanel}>
        <h2 style={styles.viewTitle}>活跃贡献者</h2>
        {stats.contributorsRank.length === 0 ? (
          <EmptyState text="等待第一位贡献者。" />
        ) : (
          <div style={styles.rankList}>
            {stats.contributorsRank.slice(0, 8).map(([name, count], index) => (
              <div key={name} style={styles.rankRow}>
                <span style={styles.rankIndex}>{index + 1}</span>
                <span style={styles.rankName}>
                  <UserRound size={16} />
                  {name}
                </span>
                <strong style={styles.rankCount}>{count}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}

function EntryCard({ entry, liked, onLike }) {
  const [open, setOpen] = useState(false)
  const village = entry.villageLabel || entry.village || '未标注'

  return (
    <article style={styles.entryCard}>
      <div style={styles.entryTop}>
        <div style={styles.entryMain}>
          <div style={styles.entryTitleRow}>
            <h3 style={styles.entryTitle}>{entry.hanzi}</h3>
            <span style={styles.villageTag}>{village}</span>
          </div>
          {entry.pinyin && <p style={styles.pinyin}>{entry.pinyin}</p>}
          <p style={styles.mandarin}>{entry.mandarin}</p>
        </div>
        {entry.audioUrl ? (
          <a title="播放发音" href={entry.audioUrl} style={styles.playLink}>
            <Volume2 size={18} />
          </a>
        ) : (
          <span title="暂无音频" style={{ ...styles.playLink, ...styles.playLinkMuted }}>
            <Pause size={18} />
          </span>
        )}
      </div>

      <div style={styles.entryActions}>
        <button type="button" onClick={onLike} disabled={liked} style={styles.likeButton}>
          <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
          {entry.likes || 0}
        </button>
        <button type="button" onClick={() => setOpen((current) => !current)} style={styles.detailButton}>
          {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          详情
        </button>
      </div>

      {open && (
        <div style={styles.detailPanel}>
          <span>贡献者：{entry.contributor || '匿名'}</span>
          <span>日期：{entry.timestamp || '未记录'}</span>
          <span>音频：{entry.audioUrl ? '已收录' : '暂无'}</span>
          {entry.audioUrl && <audio controls src={entry.audioUrl} style={styles.audioPlayer} />}
        </div>
      )}
    </article>
  )
}

function Field({ label, required, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>
        {label}
        {required && <b style={styles.required}>*</b>}
      </span>
      {children}
    </label>
  )
}

function Metric({ label, value }) {
  return (
    <div style={styles.metric}>
      <strong style={styles.metricValue}>{value}</strong>
      <span style={styles.metricLabel}>{label}</span>
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div style={styles.emptyState}>
      <AudioLines size={28} />
      <span>{text}</span>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background:
      'radial-gradient(circle at 50% -10%, rgba(212,175,55,0.13), transparent 34%), linear-gradient(180deg, #0E0C09 0%, #080705 100%)',
    color: palette.text,
    display: 'flex',
    justifyContent: 'center',
  },
  phoneFrame: {
    width: '100%',
    maxWidth: 480,
    minHeight: '100vh',
    background:
      'linear-gradient(180deg, rgba(22,18,8,0.96), rgba(14,12,9,0.98)), repeating-linear-gradient(90deg, rgba(240,230,200,0.025) 0, rgba(240,230,200,0.025) 1px, transparent 1px, transparent 12px)',
    borderLeft: `1px solid ${palette.border}`,
    borderRight: `1px solid ${palette.border}`,
    position: 'relative',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '28px 20px 18px',
    borderBottom: `1px solid ${palette.border}`,
  },
  eyebrow: {
    margin: 0,
    color: palette.goldSoft,
    fontSize: 13,
    lineHeight: 1.4,
  },
  title: {
    margin: '4px 0 0',
    color: palette.text,
    fontSize: 34,
    lineHeight: 1.08,
    letterSpacing: 0,
    fontWeight: 700,
  },
  headerSeal: {
    width: 48,
    height: 48,
    borderRadius: 8,
    border: `1px solid ${palette.gold}`,
    color: palette.gold,
    display: 'grid',
    placeItems: 'center',
    fontSize: 26,
    fontWeight: 700,
  },
  content: {
    padding: '18px 16px 96px',
  },
  form: {
    display: 'grid',
    gap: 14,
  },
  twoColumn: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 12,
  },
  field: {
    display: 'grid',
    gap: 7,
  },
  label: {
    color: palette.goldSoft,
    fontSize: 13,
    lineHeight: 1.2,
  },
  required: {
    color: palette.gold,
    marginLeft: 4,
  },
  input: {
    width: '100%',
    minHeight: 44,
    boxSizing: 'border-box',
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    background: '#100d08',
    color: palette.text,
    padding: '10px 12px',
    font: 'inherit',
    outline: 'none',
  },
  textarea: {
    minHeight: 78,
    resize: 'vertical',
    lineHeight: 1.55,
  },
  recorderPanel: {
    border: `1px solid ${palette.border}`,
    background: palette.panel,
    borderRadius: 8,
    padding: 14,
    display: 'grid',
    gap: 12,
  },
  recorderTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionKicker: {
    margin: 0,
    color: palette.dim,
    fontSize: 13,
  },
  timer: {
    display: 'block',
    color: palette.gold,
    fontSize: 28,
    lineHeight: 1.1,
    marginTop: 2,
  },
  primaryButton: {
    minHeight: 42,
    border: 0,
    borderRadius: 8,
    background: palette.gold,
    color: palette.ink,
    padding: '0 14px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    font: 'inherit',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  stopButton: {
    background: palette.red,
    color: palette.text,
  },
  waveWrap: {
    height: 56,
    borderRadius: 8,
    background: '#0d0a06',
    border: `1px solid ${palette.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: '0 10px',
    overflow: 'hidden',
  },
  waveBar: {
    width: 5,
    minHeight: 8,
    borderRadius: 5,
    background: `linear-gradient(180deg, ${palette.gold}, ${palette.goldSoft})`,
    transition: 'height 90ms ease',
  },
  previewRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  audioPlayer: {
    width: '100%',
    height: 38,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    background: palette.panelSoft,
    color: palette.gold,
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    flex: '0 0 auto',
  },
  errorText: {
    margin: 0,
    color: '#f0a58d',
    fontSize: 13,
    lineHeight: 1.45,
  },
  successText: {
    margin: 0,
    color: '#a7d59e',
    fontSize: 13,
    lineHeight: 1.45,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  submitButton: {
    minHeight: 50,
    border: 0,
    borderRadius: 8,
    background: `linear-gradient(135deg, ${palette.gold}, #f1cf66)`,
    color: palette.ink,
    font: 'inherit',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
  },
  stack: {
    display: 'grid',
    gap: 14,
  },
  viewTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  viewTitle: {
    margin: 0,
    color: palette.text,
    fontSize: 21,
    lineHeight: 1.2,
  },
  countPill: {
    border: `1px solid ${palette.border}`,
    color: palette.gold,
    background: palette.panel,
    borderRadius: 999,
    padding: '5px 10px',
    fontSize: 13,
  },
  centerState: {
    minHeight: 240,
    display: 'grid',
    placeItems: 'center',
    alignContent: 'center',
    gap: 10,
    color: palette.goldSoft,
  },
  emptyState: {
    minHeight: 150,
    borderRadius: 8,
    border: `1px dashed ${palette.border}`,
    background: 'rgba(22, 18, 8, 0.62)',
    color: palette.dim,
    display: 'grid',
    placeItems: 'center',
    alignContent: 'center',
    gap: 8,
    textAlign: 'center',
    padding: 18,
  },
  entryCard: {
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    background: palette.panel,
    padding: 14,
    display: 'grid',
    gap: 12,
  },
  entryTop: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  entryMain: {
    minWidth: 0,
    flex: 1,
  },
  entryTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  entryTitle: {
    margin: 0,
    color: palette.text,
    fontSize: 25,
    lineHeight: 1.18,
    wordBreak: 'break-word',
  },
  villageTag: {
    border: `1px solid rgba(212, 175, 55, 0.34)`,
    background: 'rgba(212, 175, 55, 0.09)',
    color: palette.gold,
    borderRadius: 999,
    padding: '4px 8px',
    fontSize: 12,
    lineHeight: 1,
  },
  pinyin: {
    margin: '7px 0 0',
    color: palette.goldSoft,
    fontSize: 14,
    lineHeight: 1.35,
    wordBreak: 'break-word',
  },
  mandarin: {
    margin: '7px 0 0',
    color: palette.text,
    fontSize: 15,
    lineHeight: 1.55,
    wordBreak: 'break-word',
  },
  playLink: {
    width: 40,
    height: 40,
    flex: '0 0 auto',
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    background: '#0d0a06',
    color: palette.gold,
    display: 'grid',
    placeItems: 'center',
    textDecoration: 'none',
  },
  playLinkMuted: {
    color: palette.brown,
  },
  entryActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  likeButton: {
    minHeight: 36,
    border: `1px solid ${palette.border}`,
    borderRadius: 8,
    background: palette.panelSoft,
    color: palette.gold,
    padding: '0 10px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    font: 'inherit',
    cursor: 'pointer',
  },
  detailButton: {
    minHeight: 36,
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: palette.goldSoft,
    padding: '0 4px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    font: 'inherit',
    cursor: 'pointer',
  },
  detailPanel: {
    borderTop: `1px solid ${palette.border}`,
    paddingTop: 12,
    display: 'grid',
    gap: 8,
    color: palette.dim,
    fontSize: 13,
    lineHeight: 1.4,
  },
  searchPanel: {
    display: 'grid',
    gap: 10,
  },
  searchBox: {
    minHeight: 46,
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    background: palette.panel,
    color: palette.goldSoft,
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 9,
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
    border: 0,
    background: 'transparent',
    color: palette.text,
    font: 'inherit',
    outline: 'none',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
  },
  metric: {
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    background: palette.panel,
    padding: '14px 10px',
    display: 'grid',
    gap: 3,
    textAlign: 'center',
  },
  metricValue: {
    color: palette.gold,
    fontSize: 26,
    lineHeight: 1,
  },
  metricLabel: {
    color: palette.dim,
    fontSize: 12,
  },
  flatPanel: {
    borderTop: `1px solid ${palette.border}`,
    paddingTop: 16,
    display: 'grid',
    gap: 12,
  },
  chartList: {
    display: 'grid',
    gap: 10,
  },
  chartRow: {
    display: 'grid',
    gridTemplateColumns: '82px minmax(0, 1fr) 28px',
    alignItems: 'center',
    gap: 8,
  },
  chartLabel: {
    color: palette.goldSoft,
    fontSize: 13,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  chartTrack: {
    height: 10,
    borderRadius: 999,
    background: '#0d0a06',
    overflow: 'hidden',
    border: `1px solid ${palette.border}`,
  },
  chartFill: {
    display: 'block',
    height: '100%',
    borderRadius: 999,
    background: `linear-gradient(90deg, ${palette.gold}, ${palette.jade})`,
  },
  chartValue: {
    color: palette.text,
    fontSize: 13,
    textAlign: 'right',
  },
  rankList: {
    display: 'grid',
    gap: 9,
  },
  rankRow: {
    minHeight: 40,
    display: 'grid',
    gridTemplateColumns: '30px minmax(0, 1fr) 36px',
    alignItems: 'center',
    gap: 8,
    borderBottom: `1px solid rgba(42,35,16,0.72)`,
  },
  rankIndex: {
    color: palette.gold,
  },
  rankName: {
    minWidth: 0,
    color: palette.text,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rankCount: {
    color: palette.goldSoft,
    textAlign: 'right',
  },
  tabBar: {
    position: 'fixed',
    left: '50%',
    bottom: 0,
    transform: 'translateX(-50%)',
    width: '100%',
    maxWidth: 480,
    height: 74,
    boxSizing: 'border-box',
    borderTop: `1px solid ${palette.border}`,
    background: 'rgba(14, 12, 9, 0.96)',
    backdropFilter: 'blur(14px)',
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    padding: '8px 8px 10px',
    zIndex: 5,
  },
  tabButton: {
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: palette.dim,
    display: 'grid',
    placeItems: 'center',
    alignContent: 'center',
    gap: 3,
    font: 'inherit',
    cursor: 'pointer',
  },
  tabButtonActive: {
    color: palette.gold,
    background: 'rgba(212, 175, 55, 0.11)',
  },
  tabLabel: {
    fontSize: 12,
    lineHeight: 1,
  },
  spinIcon: {
    animation: 'spin 900ms linear infinite',
  },
}

export default App
