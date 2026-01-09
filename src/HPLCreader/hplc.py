import pandas as pd
import json


files = ['example/standard.tsv','example/standard.tsv']
with open('example/standard.280.json','r') as f:
    stddict:dict = json.loads(f.read())
rt_thr = 0.1
dfs = [pd.read_csv(file,sep='\t') for file in files]
for i in stddict.keys():
    stddf:pd.DataFrame = []
    for df in dfs:
        df:pd.DataFrame = df.sort_values(by=df.columns[2])
        dfsample:pd.DataFrame = df.loc[(df.iloc[:,2]<=stddict[i]+rt_thr)&(df.iloc[:,2]>=stddict[i]-rt_thr)]
        iter = 1
        while dfsample.empty:
            dfsample:pd.DataFrame = df.loc[(df.iloc[:,2]<=stddict[i]+(1+0.1*iter)*rt_thr)&(df.iloc[:,2]>=stddict[i]-(1+0.1*iter)*rt_thr)]
            iter+=1
        dfsample = dfsample.sort_values(by=dfsample.columns[-1]).iloc[[-1]]
        stddf.append(dfsample)
    stddf = pd.concat(stddf,axis=0)
    stddf = stddf.reset_index().iloc[:,1:]
    print(stddf)