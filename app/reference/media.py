"""Validate normalized worker results; this module does not decode media or call AI."""
from .validation import require


def range_valid(value, duration):
    require(isinstance(value,dict), 'MEDIA_RANGE_INVALID', 'Range must be structured')
    start,end=value.get('startMs'),value.get('endMs')
    require(type(start) is int and type(end) is int and 0<=start<=end<=duration,
            'MEDIA_RANGE_INVALID','Global timecode outside original media')


def covers(ranges, duration):
    cursor=0
    for r in sorted(ranges,key=lambda r:r['startMs']):
        if r['startMs']>cursor:return False
        cursor=max(cursor,r['endMs'])
    return cursor>=duration


def validate_analysis_outputs(run, sources):
    originals={e['id']:e for e in sources}
    coverage=run.get('coverage',{}).get('sources')
    require(isinstance(coverage,list) and len(coverage)==len(sources),'COVERAGE_INVALID','Coverage is required separately for every source')
    require({c.get('sourceEvidenceId') for c in coverage}==set(originals),'COVERAGE_INVALID','No missing or duplicate source coverage')
    frames={eid:[] for eid in originals};photo_results={eid:[] for eid in originals}
    for output in run.get('outputs',[]):
        require(output.get('sourceEvidenceId') in originals,'ANALYSIS_SOURCE_MISMATCH','Output must cite an original source')
        source=originals[output['sourceEvidenceId']];duration=source.get('durationMs',0)
        require(output.get('analysisRunId')==run['id'],'DERIVED_RUN_INVALID','Output cites this run')
        require(not set(output)&{'officialStatus','approved','nextWorkAllowed','closedBy'},'NONHUMAN_OFFICIAL_DENIED','Worker output cannot carry official workflow writes')
        kind=output.get('kind')
        if source['mediaType']=='photo' and kind=='candidate':
            require(any(g.get('evidenceId')==source['id'] and g.get('channel')=='visual' for g in output.get('grounding',[])), 'ANALYSIS_SOURCE_MISMATCH','Photo candidate must ground its own original photo')
            photo_results[source['id']].append(output)
        if kind=='frame':
            index,pts=output.get('frameIndex'),output.get('ptsMs')
            require(type(index) is int and 0<=index<source.get('frameCount',0),'FRAME_INVALID','Frame outside decoded manifest')
            require(type(pts) is int and 0<=pts<=duration,'FRAME_INVALID','PTS outside source duration')
            require(bool(output.get('derivedEvidenceId')) and output.get('modelVersion')==run['model']['version'],'FRAME_INVALID','Frame needs derived evidence and exact model version')
            manifest=source.get('metadata',{}).get('framePtsMs',[])
            if manifest:require(len(manifest)==source['frameCount'] and manifest[index]==pts,'FRAME_INVALID','VFR PTS must match the decoder manifest')
            frames[source['id']].append(index)
        elif kind=='photo_result':
            require(source['mediaType']=='photo' and output.get('modelVersion')==run['model']['version'] and output.get('outcome')=='no_findings' and isinstance(output.get('summary'),str) and bool(output['summary'].strip()), 'PHOTO_RESULT_INVALID','No-findings result requires original photo, model version and review summary')
            photo_results[source['id']].append(output)
        elif kind=='transcript':
            range_valid(output,duration)
            require(all(isinstance(output.get(k),str) and output[k].strip() for k in ['segmentId','speakerLabel','originalLanguage','originalText']), 'TRANSCRIPT_INVALID','Original text/language, global range and provisional speaker are required')
            require(output['originalLanguage'] in ['ko','vi','en','other'],'TRANSCRIPT_INVALID','Language must be identified, not auto')
        elif kind=='candidate':
            require(isinstance(output.get('confidence'),(int,float)) and type(output['confidence']) is not bool and 0<=output['confidence']<=1,'CONFIDENCE_INVALID','Reference score must be [0,1]')
            require(bool(output.get('description')) and isinstance(output.get('reviewFlags'),list) and bool(output.get('grounding')),'OBSERVATION_GROUNDED','Candidate needs description, review flags and source grounding')
            for grounding in output['grounding']:
                require(grounding.get('evidenceId') in originals,'ANALYSIS_SOURCE_MISMATCH','Candidate must cite original source')
                if 'range' in grounding:range_valid(grounding['range'],originals[grounding['evidenceId']].get('durationMs',0))
                if grounding.get('channel')=='speech':require(grounding.get('claimSupport')=='reported','SPEECH_CLAIM_INVALID','Speech is a reported statement pending corroboration')
        else:require(False,'ANALYSIS_OUTPUT_INVALID','Unknown normalized output kind')
    for c in coverage:
        source=originals[c['sourceEvidenceId']];duration=source.get('durationMs',0)
        for field in ['analyzedRanges','missingRanges','audioProcessedRanges']:
            require(isinstance(c.get(field),list),'COVERAGE_INVALID',field+' is required')
            for r in c[field]:range_valid(r,duration)
        require(type(c.get('complete')) is bool,'COVERAGE_INVALID','Complete must be explicit')
        if source['mediaType']=='video':
            count=source.get('frameCount')
            require(type(count) is int and c.get('decodedFrameCount')==count,'COVERAGE_INVALID','Decoded count must match server manifest')
            indices=frames[source['id']]
            require(len(set(indices))==len(indices) and c.get('analyzedFrameCount')==len(indices),'COVERAGE_INVALID','Coverage count must match distinct grounded output frames')
            if c['complete']:
                require(run['mode']=='every_frame' and set(indices)==set(range(count)) and count>0 and not c['missingRanges'],'COVERAGE_OVERCLAIM','Full coverage requires every decoded frame without missing ranges')
                require(len(source.get('metadata',{}).get('framePtsMs',[]))==count,'COVERAGE_OVERCLAIM','Every-frame coverage needs a preserved full PTS manifest')
        elif source['mediaType']=='audio' and c['complete']:
            require(covers(c['audioProcessedRanges'],duration) and not c['missingRanges'],'COVERAGE_OVERCLAIM','Full audio coverage requires no unprocessed time ranges')
        elif source['mediaType']=='photo' and c['complete']:
            require(bool(photo_results[source['id']]) and not c['missingRanges'],'COVERAGE_OVERCLAIM','Each complete photo needs its own candidate or explicit no-findings result')
            require(not (any(o['kind']=='candidate' for o in photo_results[source['id']]) and any(o['kind']=='photo_result' for o in photo_results[source['id']])), 'PHOTO_RESULT_INVALID','Photo cannot claim no findings and emit a finding candidate')
